
const db = require('byteballcore/db');

/**
 * get reddit user data by reddit_user_id
 * @param {number} id
 * @param {function} cb
 */
exports.getRedditUserDataById = (id, cb) => {
	db.query(
		`SELECT *
		FROM reddit_users
		JOIN reddit_users_data USING(reddit_user_id, user_data_version)
		WHERE reddit_user_id=?`,
		[id],
		(rows) => {
			cb(rows[0]);
		}
	);
};