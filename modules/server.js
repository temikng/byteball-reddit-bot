'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const HttpStatus = require('http-status-codes');
const passport = require('passport');
const RedditStrategy = require('passport-reddit').Strategy;
const db = require('byteballcore/db');
const mutex = require('byteballcore/mutex.js');
const conf = require('byteballcore/conf.js');
const texts = require('./texts');
const notifications = require('./notifications');

passport.use(new RedditStrategy(
  conf.reddit,
	(accessToken, refreshToken, profile, done) => {
    if (
      !profile || 
      !profile.provider || profile.provider !== 'reddit'
    ) {
      return done( new Error(400) );
    }

    done(null, profile);
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
  const error = req.query.error;
  console.log('auth callback', state, error);
  if (error) {
    return next( new Error(422) );
  }
  checkIncomeState(state, (err, {device_address, reddit_user_id, request_reddit_user_id}) => {
    if (err) {
      return next(err);
    }

    passport.authenticate('reddit', (err, user, info) => {
      if (err) {
        return next(err);
      }

      function checkAndGetRedditUID() {
        return new Promise((resolve, reject) => {
          db.query(
            `SELECT 
              *
            FROM reddit_users
            JOIN reddit_users_data USING(reddit_user_id, user_data_version)
            WHERE reddit_name=? AND reddit_created=?`,
            [user.name, userCreated],
            (rows) => {
              if (!rows.length) {
                return db.query(
                  `INSERT INTO reddit_users
                  (reddit_name, reddit_created)
                  VALUES(?,?)`,
                  [user.name, userCreated],
                  (res) => {
                    const rUID = res.insertId;
                    db.query(
                      `INSERT INTO reddit_users_data
                      (reddit_user_id, reddit_link_karma, reddit_data)
                      VALUES(?,?,?)`,
                      [rUID, user.link_karma, JSON.stringify(user)],
                      (res) => {
                        resolve({rUID, status: 'new'});
                      }
                    );
                  }
                );
              }
    
              const row = rows[0];
              const rUID = row.reddit_user_id;
              if (row.reddit_link_karma !== user.link_karma) {
                const newVersion = Number(row.user_data_version) + 1;
                db.query(
                  `UPDATE reddit_users
                  SET version=?
                  WHERE reddit_user_id=?`,
                  [newVersion, rUID],
                  (res) => {
                    const rUID = res.insertId;
                    db.query(
                      `INSERT INTO reddit_users_data
                      (reddit_user_id, user_data_version, reddit_link_karma, reddit_data)
                      VALUES(?,?,?,?)`,
                      [rUID, newVersion, user.link_karma, JSON.stringify(user)],
                      (res) => {
                        resolve({rUID, status: 'update'});
                      }
                    );
                  }
                );
              } else {
                resolve({rUID, status: 'old'});
              }
            }
          );
        });
      }

      const userCreated = new Date(user._json.created_utc * 1000);

      const device = require('byteballcore/device.js');
      checkAndGetRedditUID()
        .then(({rUID, status}) => {
          res.send(`Recieved grand access to your Reddit account: ${user.name}`).end();

          if (status !== 'new' && (reddit_user_id === rUID || request_reddit_user_id === rUID)) {
            return device.sendMessageToDevice(device_address, 'text', texts.usedTheSameRedditAccount(user.name));
          }
    
          mutex.lock([device_address], (unlock) => {
            db.query(
              `UPDATE users SET request_reddit_user_id=? WHERE device_address=?`,
              [rUID, device_address],
              () => {
                device.sendMessageToDevice(device_address, 'text', texts.confirmRequestRedditAccount(user.name));
                unlock();
              }
            );
          });
        })
        .catch(next);
    })(req, res, next);
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  console.error('SERVER CATCH', err.message, err.status);
  let status = parseInt(err.message);
  if (err.message === 'failed to fetch user profile') {
    status = 401;
  }
  if (Number.isNaN(status)) {
    status = 500;
    notifications.notifyAdmin('server error', err.toString());
  }
  res.status(status).send(HttpStatus.getStatusText(status));
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
        return cb( new Error(400) );
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