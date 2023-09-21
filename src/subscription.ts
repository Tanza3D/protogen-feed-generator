import { isCommit, OutputSchema as RepoEvent } from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import { AtpAgent } from '@atproto/api'

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  isProtogen(name: string = "") {
    if (name.toLowerCase().endsWith("proot")) {
      return true;
    }
    if (name.toLowerCase().split(".").includes("proot")) {
      return true;
    }
    if (name.toLowerCase().split(".").includes("protogen")) {
      return true;
    }
    return (name.toLowerCase().includes(' protogen')
      || name.toLowerCase().includes('protogen ')
      || name.toLowerCase().includes(' protogens')
      || name.toLowerCase().includes('protogens ')
      || name.toLowerCase().includes('protogen')
      || name.toLowerCase().includes('protogens')
      || name.toLowerCase().includes(' proot')
      || name.toLowerCase().includes(' proots')
      || name.toLowerCase().includes(' proot ')
      || name.toLowerCase().includes(' proots ')
      || ((name.toLowerCase().includes('protogen') || name.toLowerCase().includes('proot')) && name.toLowerCase().includes('furry')));
  }
  isProtogenStrict(name: string = "") {
    return (name.toLowerCase().includes(' protogen ')
      || name.toLowerCase().includes(' protogens ')
      || name.toLowerCase().includes(' proot ')
      || name.toLowerCase().includes(' proots ')
      || ((name.toLowerCase().includes('protogen') || name.toLowerCase().includes('proot')) && name.toLowerCase().includes('furry')));
  }
  isProtogenTag(name: string = "") {
    return (name.toLowerCase().includes('#protogen')
      || name.toLowerCase().includes('#proot')
      || name.toLowerCase().includes('#protogenfeed')
      || name.toLowerCase().includes('#protogenfeedbsky'))
  }

  isFurry(name: string = "") {
    // ? this check is used to see if a user kind of seems like a furry
    // ? this just filters out any likely non-furries so we don't have to
    // ? worry about processing their users, saves alot of space and time and
    // ? yeah
    var text = name.toLowerCase();
    if (this.isProtogen(name)) return true;
    if (this.isProtogenTag(name)) return true;
    return (
      text.includes('furry')
      || text.includes('furryart')
      || text.includes('proto')
      || text.includes('beep')
      || text.includes('fanart')
      || text.includes('ych')
      || text.includes('blahaj')
      || text.includes('blåhaj')
      || text.includes('furries')
      || text.includes('fursuit')
      || text.includes('silly')
      || text.includes('fursuiter')
      || text.includes('gay')
      || text.includes('trans')
      || text.includes('snoot')
      || text.includes('doodle')
      || text.includes('thigh')
      || text.includes('x3')
      || text.includes(':3')
      || text.includes('owo')
      || text.includes('uwu')
      || text.includes('commission')
      || text.includes('cute')
      || text.includes('fox')
      || text.includes('wolf')
      || text.includes('adhd')
      || text.includes('anthro')
      || text.includes('boop')
      || text.includes('blender')
      || text.includes('vrchat')
      || text.includes('doggo')
      || text.includes('cutie')
      || text.includes('woof')
      || text.includes('meow')
      || text.includes('roomba')
      || text.includes('toaster')
      || text.includes('>w<')
      || text.includes('^w^')
      || text.includes('^^')
      || text.includes('^^')
      || text.includes('rawr')
      || text.includes('sona')
      || text.includes('fursona')
    )
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

      var protogen = await this.db
        .selectFrom('user')
        .innerJoin('protogen', 'protogen.did', 'user.did')
        .select(['displayName', 'handle'])
        .where('protogen.did', '=', post.author)
        .executeTakeFirst()

      // user not seen before, cache their profile
      var runcheck = false;
      if (this.isFurry(post.record.text)) {
        //console.log("is not protogen");
        runcheck = true;
      }

      var recheck = false;
      // ! note: remove user check, so if someone becomes protogen after a week they actually get picked up :)
      //if (!user) {
      if (runcheck) {
        await this.db.deleteFrom("user")
          .where('did', '=', post.author).execute();
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
        if (!protogen) {
          if (this.isProtogen(profile.data.handle) || this.isProtogen(profile.data.displayName) || this.isProtogen(profile.data.description) ||
            post.record.text.toLowerCase().includes("i'm a protogen")
            || post.record.text.toLowerCase().includes("im a protogen")) {
            await this.db.insertInto('protogen').values({ did: post.author }).execute()
            console.log('\x1b[33mnew protogen collected!!\x1b[0m')
            console.log(`${post.author} is ${profile.data.handle} with display name '${profile.data.displayName}'`)
            recheck = true;
          } else {
            console.log("is not protogen");
          }
        }
      }
      //}

      // re-fetch db record
      if (recheck) {
        protogen = await this.db
          .selectFrom('user')
          .innerJoin('protogen', 'protogen.did', 'user.did')
          .select(['displayName', 'handle'])
          .where('protogen.did', '=', post.author)
          .executeTakeFirst()
      }

      // store protogen posts with correct feed
      let feed = ''
      if (protogen) {
        console.log(`new proot post: '${protogen.displayName}' @${protogen.handle}: '${post.record.text}'`)
        feed = 'protogens'
      }
      if (this.isProtogenTag(post.record.text) || this.isProtogenStrict(post.record.text)) {
        console.log(`new post about proot: '${post.record.text}'`);
        feed = 'protogens'
      }
      if (feed != "") {
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