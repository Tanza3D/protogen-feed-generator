import { isCommit, OutputSchema as RepoEvent } from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import { AtpAgent } from '@atproto/api'

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  isProtogen(name: string = "") {
    return (name.toLowerCase().includes(' protogen')
      || name.toLowerCase().includes('protogen ')
      || name.toLowerCase().includes(' proot')
      || name.toLowerCase().includes(' proot ') ||
      ((name.toLowerCase().includes('protogen') || name.toLowerCase().includes('proot')) && name.toLowerCase().includes('furry')));
  }
  async handleEvent(evt: RepoEvent, agent: AtpAgent) {
    if (!isCommit(evt)) return
    const ops = await getOpsByType(evt)

    // handle post creates
    for (const post of ops.posts.creates) {
      const user = await this.db
        .selectFrom('user')
        .select(['did', 'displayName', 'handle'])
        .where('did', '=', post.author)
        .executeTakeFirst()

      // user not seen before, cache their profile
      if (!user) {
        const profile = await agent.api.app.bsky.actor.getProfile({ actor: post.author })
        console.log(`fetched profile for ${post.author}: @${profile.data.handle} ${profile.data.displayName}`)
        await this.db
          .insertInto('user')
          .values({
            did: post.author,
            handle: profile.data.handle,
            displayName: profile.data.displayName,
            bio: profile.data.description,
            indexedAt: new Date().toISOString(),
          })
          .execute()

        if (this.isProtogen(profile.data.handle) || this.isProtogen(profile.data.displayName) || this.isProtogen(profile.data.description))
        {
          await this.db.insertInto('protogen').values({ did: post.author }).execute()
          console.log('\x1b[33mnew protogen collected!!\x1b[0m')
          console.log(`${post.author} is ${profile.data.handle} with display name '${profile.data.displayName}'`)
        } else {
          console.log("is not protogen");
        }
      } else if (user.displayName === user.handle) {
        // i was saving handle as displayName... :(
        const profile = await agent.api.app.bsky.actor.getProfile({ actor: post.author })
        console.log(`refetched invalid profile for ${post.author}: oldHandle=@${user.handle} newHandle=@${profile.data.handle} displayName='${profile.data.displayName}'`)
        await this.db
          .updateTable('user')
          .set({
            displayName: profile.data.displayName ?? null,
            handle: profile.data.handle,
          })
          .where('did', '=', post.author)
          .execute()

        if (this.isProtogen(profile.data.handle) || this.isProtogen(profile.data.displayName) || this.isProtogen(profile.data.description)) {
          const existingprotogen = await this.db
            .selectFrom('protogen')
            .select('did')
            .where('did', '=', post.author)
            .executeTakeFirst()

          if (!existingprotogen) {
            await this.db
              .insertInto('protogen')
              .values({ did: post.author })
              .onConflict(oc => oc.doNothing())
              .execute()
            console.log('protogen collected from new display name!!!')
            console.log(`${post.author} is ${profile.data.handle} with display name '${profile.data.displayName}'`)
          }
        }
      }

      // re-fetch db record
      const protogen = await this.db
        .selectFrom('user')
        .innerJoin('protogen', 'protogen.did', 'user.did')
        .select(['displayName', 'handle'])
        .where('protogen.did', '=', post.author)
        .executeTakeFirst()

      // store protogen posts with correct feed
      let feed = ''
      if (protogen) {
        console.log(`new proot post: '${protogen.displayName}' @${protogen.handle}: '${post.record.text}'`)
        feed = 'protogens'
      }
      if (post.record.text.toLowerCase().includes('#protogen')
        || post.record.text.toLowerCase().includes('#proot')) {
        console.log(`new post about proot: '${post.record.text}'`);
        feed = 'protogens'
      }
      await this.db
        .insertInto('post')
        .values({
          uri: post.uri,
          cid: post.cid,
          replyParent: post.record?.reply?.parent.uri ?? null,
          replyRoot: post.record?.reply?.root.uri ?? null,
          indexedAt: new Date().toISOString(),
          text: post.record.text,
          feed: feed,
          author: post.author,
          likeCount: 0,
        })
        .onConflict(oc => oc.doNothing())
        .execute()
    }

    // handle deletes
    const postsToDelete = ops.posts.deletes.map((del) => del.uri)
    if (postsToDelete.length > 0) {
      await this.db
        .deleteFrom('post')
        .where('uri', 'in', postsToDelete)
        .execute()
    }

    // handle repost creates
    const protogens = await this.db.selectFrom('protogen').select('did').execute()
    const repostsToCreate = ops.reposts.creates
      .filter((create) => {
        // only protogen posts
        return protogens.find((protogen) => protogen.did === create.author)
      })
      .map((create) => {
        return {
          uri: create.uri,
          cid: create.cid,
          indexedAt: new Date().toISOString(),
        }
      })
    if (repostsToCreate.length > 0) {
      await this.db
        .insertInto('repost')
        .values(repostsToCreate)
        .onConflict(oc => oc.doNothing())
        .execute()
    }

    // handle reposts to delete
    const repostsToDelete = ops.reposts.deletes.map((del) => del.uri)
    if (repostsToDelete.length > 0) {
      try {
        await this.db
          .deleteFrom('repost')
          .where('uri', 'in', repostsToDelete)
          .execute()
      } catch (e) {
        console.log('delete failed for whatever reason', repostsToDelete)
      }
    }

  }
}