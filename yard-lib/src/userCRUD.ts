import axios from "axios"
import config from "config"

export type Post = {
    kind: string,
    id: string,
    selftext: string,
    score: number,
    body: string,
    title: string,
    created: number,
}

export class userCrud {
    token: string;
    clientid: string;
    secret: string;
    username: string;
    password: string;
    userAgent: string;

    //constructor for userCrud
    constructor() {
        this.clientid = config.get("credentials.clientid");
        this.secret = config.get("credentials.secret");
        this.username = config.get("credentials.username");
        this.password = config.get("credentials.password");
        this.userAgent = config.has("app.userAgent")
            ? config.get("app.userAgent")
            : `linux:shredditweb:1.0.0 (by /u/${this.username})`;
        this.token = ""
    }

    // method to edit comment using axios and reddit api
    async editComment(post: Post, text: string, dryRun?: boolean) {
        const headers = {
            'Authorization': `bearer ${this.token}`,
            'User-Agent': this.userAgent,
            'Content-Type': 'application/x-www-form-urlencoded',
        }
        console.log(`Editing post "${JSON.stringify(post)}" with "${text}"`)
        if (dryRun) {
            console.log("Dry run, not editing")
            return
        }

        const payload = new URLSearchParams({
            thing_id: `${post.kind}_${post.id}`,
            text: text,
        }).toString()
        var res = await axios.post(`https://oauth.reddit.com/api/editusertext`, payload, {
            headers: headers
        })

        console.log(`Edited ${JSON.stringify(post)} - response: ${res.status} ${res.statusText} ${JSON.stringify(res.data)}`)
    }

    async deletePost(post: Post, dryRun?: boolean) {
        console.log(`Deleting post ${JSON.stringify(post)}`)
        const headers = {
            'Authorization': `bearer ${this.token}`,
            'User-Agent': this.userAgent,
            'Content-Type': 'application/x-www-form-urlencoded',
        }
        if (dryRun) {
            console.log("Dry run, not deleting")
            return
        }
        const payload = new URLSearchParams({
            id: `${post.kind}_${post.id}`,
        }).toString()
        var res = await axios.post(`https://oauth.reddit.com/api/del`, payload, {
            headers: headers
        })

        console.log(`Deleted ${JSON.stringify(post)}, response: ${res.status} ${res.statusText} ${JSON.stringify(res.data)}`)
    }

    async getAllCommentsDetails() {
        var comments = await axios.get(`https://oauth.reddit.com/user/${this.username}/comments.json`, {
            headers: {
                'Authorization': `bearer ${this.token}`,
                'User-Agent': this.userAgent,
            }
        })

        // console.log(comments.data.data.children)

        return comments.data.data.children.map((comment: any) => {
            return { id: comment.data.id, body: comment.data.body, kind: comment.kind, created: comment.data.created, score: comment.data.score } as Post
        })
    }

    async getAllSubmissionsDetails() {
        var submissions = await axios.get(`https://oauth.reddit.com/user/${this.username}/submitted.json`, {
            headers: {
                'Authorization': `bearer ${this.token}`,
                'User-Agent': this.userAgent
            }
        })
        // console.log(submissions.data.data.children)
        return submissions.data.data.children.map((sub: any) => {
            return { id: sub.data.id, title: sub.data.title, selftext: sub.data.selftext, kind: sub.kind, created: sub.data.created, score: sub.data.score } as Post
        })
    }


    // method to authenticate using axios and reddit api
    public async authenticate() {
        const payload = new URLSearchParams({
            grant_type: "password",
            username: this.username,
            password: this.password,
        }).toString()

        try {
            var auth = await axios.post("https://www.reddit.com/api/v1/access_token", payload, {
                auth: {
                    username: this.clientid,
                    password: this.secret
                },
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': this.userAgent
                }
            })

            this.token = auth.data.access_token
            console.log(`Authenticated with token`)
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status ?? "unknown"
                const body = JSON.stringify(error.response?.data ?? {})
                throw new Error(`Reddit auth failed (${status}). Response: ${body}`)
            }
            throw error
        }
    }
}
