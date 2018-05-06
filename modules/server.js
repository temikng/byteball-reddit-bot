'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const passport = require('passport');
const RedditStrategy = require('passport-reddit').Strategy;
const db = require('byteballcore/db');
const mutex = require('byteballcore/mutex.js');
const conf = require('byteballcore/conf.js');
const texts = require('./texts');

passport.use(new RedditStrategy(
  conf.reddit,
	(accessToken, refreshToken, profile, done) => {
    if (
      !profile || 
      !profile.provider || profile.provider !== 'reddit'
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

app.get('/auth', (req, res, next) => {
  const state = req.query.state;
  console.log('auth', state);
  checkIncomeState(state, (err) => {
    if (err) {
      return next(err);
    }

    passport.authenticate('reddit', {state})(req, res, next);
  });
});

app.get('/auth/callback', (req, res, next) => {
  const state = req.query.state;
  console.log('auth callback', state);
  checkIncomeState(state, (err, {device_address, reddit_user_id}) => {
    if (err) {
      return next(err);
    }

    passport.authenticate('reddit', (err, user, info) => {
      if (err) {
        console.error(err);
        return next(err);
      }

      const userCreated = new Date(user._json.created * 1000);

      db.query(
        `SELECT 
          reddit_user_id
        FROM reddit_users
        WHERE reddit_name=? AND reddit_link_karma=? AND reddit_created=?`,
        [user.name, user.link_karma, userCreated],
        (rows) => {
          if (!rows.length) {
            //TODO: create new reddit_users
          }


        }
      );
      const device = require('byteballcore/device.js');
      const redditUID = 4; // tmp
      if (redditUID === reddit_user_id) {
        //TODO: send message: "the same reddit account"
      }

      mutex.lock([device_address], (unlock) => {
        db.query(
          `UPDATE users SET request_reddit_user_id=? WHERE device_address=?`,
          [redditUID, device_address],
          () => {
            device.sendMessageToDevice(device_address, 'text', texts.confirmRequestRedditAccount(user.name));
            res.send('DONE');
            unlock();
          }
        );
      });
    })(req, res, next);
  });
});

function checkIncomeState(state, cb) {
  if (!state) {
    return cb( new Error(422) );
  }

  db.query(
    `SELECT * FROM users WHERE device_address = ?`,
    [state],
    (rows) => {
      if (!rows.length) {
        return;
      }

      cb(null, rows[0]);
    }
  );
}

exports.start = () => {

	app.listen(conf.web.port,  () => {
		console.log(`== server start listen on ${conf.web.port} port`);
	});
};

exports.checkConfig = (error = '') => {
  if (
    !conf.reddit ||
    !conf.reddit.clientID || !conf.reddit.clientSecret || !conf.reddit.callbackURL
  ) {
    error += '';
  }
  return error;
};