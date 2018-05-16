
const conf = require('byteballcore/conf');
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

/**
 * get count of usd by reddit account karma value
 * @param {number} karma
 * @return {number}
 */
exports.getRewardInUSDByKarma = (karma) => {
	console.error('!!!!!!!!!!!!!!getRewardInUSDByKarma', conf.sortedRewardInUSD);
	let prevCountKarma = 0;
	for (let countKarma in conf.sortedRewardInUSD) {
		if (!conf.sortedRewardInUSD.hasOwnProperty(countKarma)) continue;
		if (karma < countKarma) {
			return conf.sortedRewardInUSD[prevCountKarma];
		}
		prevCountKarma = countKarma;
	}
	return conf.sortedRewardInUSD[prevCountKarma] || 0;
}