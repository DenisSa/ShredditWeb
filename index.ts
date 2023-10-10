
var request = require("request");
var config = require("config");

var clientid = config.get("credentials.clientid");
var secret = config.get("credentials.secret");
var username = config.get("credentials.username");
var password = config.get("credentials.password");

var options = {
                url: "https://www.reddit.com/api/v1/access_token",
                method: 'POST',
                contentType: 'application/x-www-form-urlencoded',
                headers: {
                    'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.82 Safari/537.36"
                },
                auth: {
                    'username': clientid,
                    'password': secret
                },
                body: `grant_type=password&username=${username}&password=${password}`,
             };

request(options, function(err: string, res: string, body: string) {
    var json = JSON.parse(body);
    var token = json['access_token'];
    
    if(token){
        console.log("Authenticated")
    }
    else{
        console.log("Could not authenticate - check credentials")
    }
});