
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
		WHERE reddit_user_id=?`,
		[id],
		(rows) => {
			cb(rows[0]);
		}
	);
};