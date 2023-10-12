import axios from "axios"
import config from "config"

//class userCrud
export class userCrud {
    token: string;
    clientid: string;
    secret: string;
    username: string;
    password: string;

    //constructor for userCrud
    constructor(bearer?: string) {
        this.token = "";
        this.clientid = config.get("credentials.clientid");
        this.secret = config.get("credentials.secret");
        this.username = config.get("credentials.username");
        this.password = config.get("credentials.password");
        if (!bearer) {
            this.authenticate().then(() => {
                console.log("authenticated")
            }).catch((err) => {
                console.log(err)
            })
        }
    }

    // method to edit comment using axios and reddit api
    async editComment() {
        var edit = await axios.post("https://oauth.reddit.com/api/editusertext", {
            text: "new text",
            thing_id: "t3_4b8l8t"
        }, {
            headers: {
                'Authorization': `bearer ${this.token}`,
                'User-Agent': "Mozilla/5.0"
            }
        })

        console.log(edit.data)
    }

    async getComments() {
        var comments = await axios.get(`https://oauth.reddit.com/user/${this.username}/comments.json`, {
            headers: {
                'Authorization': `bearer ${this.token}`,
                'User-Agent': "Mozilla/5.0",
            }
        })

        console.log(comments.data.data.children)
    }

    async getSubmissions() {
        var submissions = await axios.get(`https://oauth.reddit.com/user/${this.username}/submitted`, {
            headers: {
                'Authorization': `bearer ${this.token}`,
                'User-Agent': "Mozilla/5.0"
            }
        })
        console.log(submissions.data)
    }


    // method to authenticate using axios and reddit api
    private async authenticate() {
        var auth = await axios.post("https://www.reddit.com/api/v1/access_token", `grant_type=password&username=${this.username}&password=${this.password}`, {
            auth: {
                username: this.clientid,
                password: this.secret
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': "Mozilla/5.0"
            }
        })

        this.token = auth.data.access_token
        console.log(`bearer: ${this.token}`)
    }
}