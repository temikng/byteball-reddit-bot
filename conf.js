/*jslint node: true */
"use strict";
exports.port = null;
//exports.myUrl = 'wss://mydomain.com/bb';
exports.bServeAsHub = false;
exports.bLight = false;

exports.storage = 'sqlite';

// TOR is recommended.  If you don't run TOR, please comment the next two lines
//exports.socksHost = '127.0.0.1';
//exports.socksPort = 9050;

exports.hub = 'byteball.org/bb';
exports.deviceName = 'Reddit attestation bot';
exports.permanent_pairing_secret = '0000';
exports.control_addresses = [''];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';

exports.bIgnoreUnpairRequests = true;
exports.bSingleAddress = false;
exports.bStaticChangeAddress = true;
exports.KEYS_FILENAME = 'keys.json';

// email
exports.useSmtp = false;
exports.admin_email = '';
exports.from_email = '';

// witnessing
exports.bRunWitness = false;
exports.THRESHOLD_DISTANCE = 20;
exports.MIN_AVAILABLE_WITNESSINGS = 100;

exports.priceInBytes = 3000;

// set this in conf.json
exports.salt = null;

// Reddit application options
exports.redditAuthURL = 'http://127.0.0.1:8080/auth';
exports.reddit = {
  clientID: '--use-reddit-consumer-key--',
  clientSecret: '--use-reddit-consumer-secret--',
  callbackURL: 'http://127.0.0.1:8080/auth/callback'
};

// Reddit karma rewards
exports.arrRedditKarmaRewardsInUsd = [
	{threshold: 1e5, rewardInUsd: 0.2},
	{threshold: 1e6, rewardInUsd: 3},
	{threshold: 10e6, rewardInUsd: 40},
	{threshold: 100e6, rewardInUsd: 150}
];

// web server
exports.web = {
  port: 8080
};
