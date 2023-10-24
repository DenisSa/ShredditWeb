import { generateRandomTextString } from "./textGenerator"
import { userCrud, Post } from "./userCRUD"

const DRY_RUN = false
const KEEP_SCORE = 100
const TS_WEEK_AGO = (Date.now() / 1000) - 604800

async function sleep(ms: number) {
    if (DRY_RUN) {
        return
    }
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    //YARD - Yet Another Reddit Deleter

    //get all comments (iterate through all pages)
    //get all submissions (iterate through all pages)
    //combine into single array and extract thing_ids and original message
    //edit each comment to say something else and delete it

    var crud = new userCrud()
    await crud.authenticate()

    var submissions = await crud.getAllSubmissionsDetails()
    var comments = await crud.getAllCommentsDetails()

    var allPosts = comments.concat(submissions)

    console.log("Removing all posts with score below 5 that are older than 7 days")

    allPosts = allPosts.filter((post: Post) => {
        return post.score < KEEP_SCORE && post.created < TS_WEEK_AGO
    })

    console.log(`Found ${allPosts.length} posts to delete`)

    for (const post of allPosts) {
        if (post.selftext || post.body) {
            await crud.editComment(post, generateRandomTextString(), DRY_RUN)
            await sleep(1000)
        }
        await crud.deletePost(post, DRY_RUN)
        await sleep(1000)
        // return;
    }

    console.log("done")

}

main()

