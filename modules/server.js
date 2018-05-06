'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const passport = require('passport');
const RedditStrategy = require('passport-reddit').Strategy;
const db = require('byteballcore/db');
const conf = require('byteballcore/conf.js');

passport.use(new RedditStrategy(
  conf.reddit,
	(accessToken, refreshToken, profile, done) => {
    if (
      !profile || 
      !profile.provider || prifile.provider !== 'reddit'
    ) {
      return done('');
    }

    fs.writeFile(path.join(__dirname, '..', 'tmp', Date.now() + '.json'), JSON.stringify(profile, null, 4), (err) => {
      done(null, profile);
    });
	}
));

const app = express();

app.use(passport.initialize());
// app.use(passport.session());

let state;
app.get('/auth', (req, res, next) => {
  state = req.query.state;
  if (!state) {
    return res.status(422).send('ERROR');
  }

  passport.authenticate('reddit', {state})(req, res, next);
});

app.get('/auth/callback', (req, res, next) => {
  // Check for origin via state token
  console.log('auth callback', req.query.state, state);
  if (req.query.state !== state) {
    next( new Error(403) );
  }

  passport.authenticate('reddit', (err, user, info) => {
    if (err) {
      console.error(err);
      return next(err);
    }
    
    res.send('DONE');
  })(req, res, next);  
});


exports.start = () => {

	app.listen(conf.web.port,  () => {
		console.log(`== server start listen on ${conf.web.port} port`);
	});
}

exports.checkConfig = (error = '') => {
  if (
    !conf.reddit ||
    !conf.reddit.clientID || !conf.reddit.clientSecret || !conf.reddit.callbackURL
  ) {
    error += '';
  }
  return error;
}