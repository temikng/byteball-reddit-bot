/*jslint node: true */
'use strict';
const constants = require('byteballcore/constants.js');
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const eventBus = require('byteballcore/event_bus.js');
const texts = require('./modules/texts.js');
const validationUtils = require('byteballcore/validation_utils');
const headlessWallet = require('headless-byteball');
const notifications = require('./modules/notifications');
const conversion = require('./modules/conversion.js');
const redditAttestation = require('./modules/reddit-attestation.js');
const reward = require('./modules/reward.js');
const server = require('./modules/server');

/**
 * user pairs his device with bot
 */
eventBus.on('paired', (from_address) => {
	respond(from_address, '', texts.greeting());
});

/**
 * ready headless and conversion rates
 */
eventBus.once('headless_and_rates_ready', handleHeadlessAndRatesReady);

/**
 * ready headless wallet
 */
eventBus.once('headless_wallet_ready', handleWalletReady);

function handleHeadlessAndRatesReady() {
	if (conf.bRunWitness) {
		require('byteball-witness');
		eventBus.emit('headless_wallet_ready');
	} else {
		headlessWallet.setupChatEventHandlers();
	}

	/**
	 * user sends message to the bot
	 */
	eventBus.on('text', (from_address, text) => {
		respond(from_address, text.trim());
	});

	/**
	 * user pays to the bot
	 */
	eventBus.on('new_my_transactions', handleNewTransactions);

	/**
	 * pay is confirmed
	 */
	eventBus.on('my_transactions_became_stable', handleTransactionsBecameStable);
}

function handleWalletReady() {
	let error = '';

	/**
	 * check if database tables is created
	 */
	let arrTableNames = [
		'users','reddit_users','receiving_addresses','transactions','attestation_units',
		'rejected_payments','reward_units','referral_reward_units'
	];
	db.query("SELECT name FROM sqlite_master WHERE type='table' AND NAME IN (?)", [arrTableNames], (rows) => {
		if (rows.length !== arrTableNames.length) {
			error += texts.errorInitSql();
		}

		/**
		 * check if config is filled correct
		 */
		if (conf.bUseSmtp && (!conf.smtpHost || !conf.smtpUser || !conf.smtpPassword)) {
			error += texts.errorConfigSmtp();
		}
		if (!conf.admin_email || !conf.from_email) {
			error += texts.errorConfigEmail();
    }
    server.checkConfig(error);

		if (error) {
			throw new Error(error);
		}

		headlessWallet.issueOrSelectAddressByIndex(0, 0, (address1) => {
			console.log('== investor attestation address: ' + address1);
			redditAttestation.redditAttestorAddress = address1;
			reward.distributionAddress = address1;

			// headlessWallet.issueOrSelectAddressByIndex(0, 1, (address2) => {
				// console.log('== distribution address: ' + address2);
				// reward.distributionAddress = address2;

        server.start();

				// setInterval(redditAttestation.retryPostingAttestations, 10*1000);
				// setInterval(reward.retrySendingRewards, 10*1000);
				setInterval(moveFundsToAttestorAddresses, 10*1000);
				// setInterval(verifyInvestor.retryCheckAuthAndPostVerificationRequest, 10*1000);
				// setInterval(pollVerificationResults, 60*1000);
			// });
		});
	});
}

function moveFundsToAttestorAddresses() {
	let network = require('byteballcore/network.js');
	if (network.isCatchingUp())
		return;

	console.log('moveFundsToAttestorAddresses');
	db.query(
		`SELECT DISTINCT receiving_address
		FROM receiving_addresses 
		CROSS JOIN outputs ON receiving_address = address 
		JOIN units USING(unit)
		WHERE is_stable=1 AND is_spent=0 AND asset IS NULL
		LIMIT ?`,
		[constants.MAX_AUTHORS_PER_UNIT],
		(rows) => {
			// console.error('moveFundsToAttestorAddresses', rows);
			if (rows.length === 0) {
				return;
			}

			const arrAddresses = rows.map(row => row.receiving_address);
			// console.error(arrAddresses, redditAttestation.redditAttestorAddress);
			const headlessWallet = require('headless-byteball');
			headlessWallet.sendMultiPayment({
				asset: null,
				to_address: redditAttestation.redditAttestorAddress,
				send_all: true,
				paying_addresses: arrAddresses
			}, (err, unit) => {
				if (err) {
					console.error("failed to move funds: " + err);
					let balances = require('byteballcore/balances');
					balances.readBalance(arrAddresses[0], (balance) => {
						console.error('balance', balance);
						notifications.notifyAdmin('failed to move funds', err + ", balance: " + JSON.stringify(balance));
					});
				} else {
					console.log("moved funds, unit " + unit);
				}
			});
		}
	);
}

function handleNewTransactions(arrUnits) {
	const device = require('byteballcore/device.js');
	db.query(
		`SELECT
			amount, asset, unit,
			receiving_address, device_address, user_address, price, 
			${db.getUnixTimestamp('last_price_date')} AS price_ts
		FROM outputs
		CROSS JOIN receiving_addresses ON receiving_addresses.receiving_address = outputs.address
		WHERE unit IN(?)
			AND NOT EXISTS (
				SELECT 1
				FROM unit_authors
				CROSS JOIN my_addresses USING(address)
				WHERE unit_authors.unit = outputs.unit
			)`,
		[arrUnits],
		(rows) => {
			rows.forEach((row) => {

				checkPayment(row, (error) => {
					if (error) {
						return db.query(
							`INSERT ${db.getIgnore()} INTO rejected_payments
							(receiving_address, price, received_amount, payment_unit, error)
							VALUES (?,?,?,?,?)`,
							[row.receiving_address, row.price, row.amount, row.unit, error],
							() => {
								device.sendMessageToDevice(row.device_address, 'text', error);
							}
						);
					}

					db.query(
						`INSERT INTO transactions
						(receiving_address, price, received_amount, payment_unit)
						VALUES (?,?,?,?)`,
						[row.receiving_address, row.price, row.amount, row.unit],
						() => {
							device.sendMessageToDevice(row.device_address, 'text', texts.receivedYourPayment(row.amount));
						}
					);

				}); // checkPayment

			});
		}
	);
}

function checkPayment(row, onDone) {
	if (row.asset !== null) {
		return onDone("Received payment in wrong asset");
	}

	if (row.amount < conf.priceInBytes) {
		const text = `Received ${row.amount} Bytes from you, which is less than the expected ${conf.priceInBytes} Bytes.`;
		return onDone(text + '\n\n' + texts.pleasePay(row.receiving_address, conf.priceInBytes));
	}

	function resetUserAddress() {
		db.query("UPDATE users SET user_address=NULL WHERE device_address=?", [row.device_address]);
	}
	
	db.query("SELECT address FROM unit_authors WHERE unit=?", [row.unit], (author_rows) => {
		if (author_rows.length !== 1) {
			resetUserAddress();
			return onDone("Received a payment but looks like it was not sent from a single-address wallet.  "+texts.switchToSingleAddress());
		}
		if (author_rows[0].address !== row.user_address){
			resetUserAddress();
			return onDone("Received a payment but it was not sent from the expected address "+row.user_address+".  "+texts.switchToSingleAddress());
		}
		onDone();
	});
}

function handleTransactionsBecameStable(arrUnits) {
	const device = require('byteballcore/device.js');
	db.query(
		`SELECT 
			transaction_id, device_address
		FROM transactions
		JOIN receiving_addresses USING(receiving_address)
		WHERE payment_unit IN(?)`,
		[arrUnits],
		(rows) => {
			rows.forEach((row) => {
				db.query(
					`UPDATE transactions 
					SET confirmation_date=${db.getNow()}, is_confirmed=1 
					WHERE transaction_id=?`,
					[row.transaction_id],
					() => {
						device.sendMessageToDevice(row.device_address, 'text', texts.paymentIsConfirmed());
					}
				);
			});
		}
	);
}

/**
 * scenario for responding to user requests
 * @param from_address
 * @param text
 * @param response
 */
function respond (from_address, text, response = '') {
	const device = require('byteballcore/device.js');
	const mutex = require('byteballcore/mutex.js');
	readUserInfo(from_address, (userInfo) => {

		function checkRedditUser() {
			return new Promise((resolve, reject) => {
				/**
				 * check if user request new reddit account
				 */
				if (userInfo.request_reddit_user_id) {
					const reqRedditUID = userInfo.request_reddit_user_id;
	
					if (text === 'yes') {
						return mutex.lock([from_address], (unlock) => {
							return db.query(
								`UPDATE users 
								SET request_reddit_user_id=?, reddit_user_id=?
								WHERE device_address=?`,
								[null, reqRedditUID, from_address],
								() => {
									unlock();

									getRedditUserDataById(reqRedditUID, (row) => {
										resolve(texts.confirmedRequestRedditAccount(row.reddit_name) + '\n\n' + texts.insertMyAddress());
									});
								}
							);
						});
					}
					if (text === 'no') {
						return mutex.lock([from_address], (unlock) => {
							return db.query(
								`UPDATE users 
								SET request_reddit_user_id=?
								WHERE device_address=?`,
								[null, from_address],
								() => {
									unlock();

									getRedditUserDataById(reqRedditUID, (row) => {
										device.sendMessageToDevice(from_address, 'text', texts.unconfirmedRequestRedditAccount(row.reddit_name));
										resolve();
									});
								}
							);
						});
					}

					return getRedditUserDataById(reqRedditUID, (row) => {
						resolve(texts.confirmRequestRedditAccount(row.reddit_name));
					});
				}

				if (!userInfo.reddit_user_id) {		
					resolve(texts.allowAccessToRedditAccount(userInfo.device_address));
				} else {
					resolve();
				}
			});
		}

		function checkUserAddress() {
			return new Promise((resolve, reject) => {
				if (validationUtils.isValidAddress(text)) {
					userInfo.user_address = text;
					response += texts.goingToAttestAddress(userInfo.user_address);
					return db.query(
						'UPDATE users SET user_address=? WHERE device_address=?',
						[userInfo.user_address, from_address],
						() => {
							resolve();
						}
					);
				}
				if (userInfo.user_address) return resolve();
				resolve(texts.insertMyAddress());
			});
		}

		checkRedditUser()
			.then((redditUserResponse) => {
				if (redditUserResponse) {
					return device.sendMessageToDevice(from_address, 'text', (response ? response + '\n\n' : '') + redditUserResponse);
				}

				return checkUserAddress();
			})
			.then((userAddressResponse) => {
				if (userAddressResponse) {
					return device.sendMessageToDevice(from_address, 'text', (response ? response + '\n\n' : '') + userAddressResponse);
				}

				return readOrAssignReceivingAddress(from_address, userInfo);
			})
			.then( ({receiving_address, post_publicly}) => {
				const price = conf.priceInBytes;

				if (text === 'private' || text === 'public') {
					post_publicly = (text === 'public') ? 1 : 0;
					db.query(
						`UPDATE receiving_addresses 
						SET post_publicly=? 
						WHERE device_address=? AND user_address=? AND reddit_user_id=?`,
						[post_publicly, from_address, userInfo.user_address, userInfo.reddit_user_id]
					);
					response += (text === "private") ? texts.privateChoose() : texts.publicChoose();
				}

				if (post_publicly === null) {
					return device.sendMessageToDevice(from_address, 'text', (response ? response + '\n\n' : '') + texts.privateOrPublic());
				}

				if (text === 'again') {
					return device.sendMessageToDevice(
						from_address,
						'text',
						(response ? response + '\n\n' : '') + texts.pleasePay(receiving_address, price) + '\n\n' +
						((post_publicly === 0) ? texts.privateChoose() : texts.publicChoose())
					);
				}

				db.query(
					`SELECT
						transaction_id, is_confirmed, received_amount, attestation_date
					FROM transactions
					JOIN receiving_addresses USING(receiving_address)
					LEFT JOIN attestation_units USING(transaction_id)
					WHERE receiving_address=?
					ORDER BY transaction_id DESC
					LIMIT 1`,
					[receiving_address],
					(rows) => {
						/**
						 * if user didn't pay yet
						 */
						if (rows.length === 0) {
							return device.sendMessageToDevice(
								from_address,
								'text',
								(response ? response + '\n\n' : '') + texts.pleasePayOrPrivacy(receiving_address, price, post_publicly)
							);
						}

						const row = rows[0];

						/**
						 * if user payed, but transaction did not become stable
						 */
						if (row.is_confirmed === 0) {
							return device.sendMessageToDevice(
								from_address,
								'text',
								(response ? response + '\n\n' : '') + texts.receivedYourPayment(row.received_amount)
							);
						}

						/**
						 * reddit account is in attestation
						 */
						if (!row.attestation_date) {
							return device.sendMessageToDevice(
								from_address,
								'text',
								(response ? response + '\n\n' : '') + texts.inAttestation()
							);
						}

						/**
						 * no more available commands, reddit account is attested
						 */
						return device.sendMessageToDevice(
							from_address,
							'text',
							(response ? response + '\n\n' : '') + texts.alreadyAttested(row.attestation_date)
						);

					}
				);

			})
			.catch((err) => {
				notifications.notifyAdmin('respond error', err.toString());
			});
	});
}

/**
 * get reddit user data by reddit_user_id
 * @param id 
 * @param cb 
 */
function getRedditUserDataById(id, cb) {
	db.query(
		`SELECT *
		FROM reddit_users 
		WHERE reddit_user_id=?`,
		[id],
		(rows) => {
			cb(rows[0]);
		}
	);
}

/**
 * get user's information by device address
 * or create new user, if it's new device address
 * @param device_address
 * @param callback
 */
function readUserInfo(device_address, callback) {
	db.query(
		`SELECT user_address, reddit_user_id, request_reddit_user_id 
		FROM users 
		WHERE device_address = ?`, 
		[device_address], 
		(rows) => {
			if (rows.length) {
				callback(rows[0]);
			} else {
				db.query(`INSERT ${db.getIgnore()} INTO users (device_address) VALUES(?)`, [device_address], () => {
					callback({ device_address, user_address: null });
				});
			}
		}
	);
}

/**
 * read or assign receiving address
 * @param device_address
 * @param userInfo
 * @return Promise
 */
function readOrAssignReceivingAddress(device_address, userInfo) {
	return new Promise((resolve, reject) => {
		const mutex = require('byteballcore/mutex.js');
		mutex.lock([device_address], (unlock) => {
			db.query(
				`SELECT receiving_address, post_publicly, ${db.getUnixTimestamp('last_price_date')} AS price_ts
				FROM receiving_addresses 
				WHERE device_address=? AND user_address=? AND reddit_user_id=?`,
				[device_address, userInfo.user_address, userInfo.reddit_user_id],
				(rows) => {
					if (rows.length > 0) {
						let row = rows[0];
						resolve({receiving_address: row.receiving_address, post_publicly: row.post_publicly});
						return unlock();
					}
	
					headlessWallet.issueNextMainAddress((receiving_address) => {
						db.query(
							`INSERT INTO receiving_addresses 
							(device_address, user_address, reddit_user_id, receiving_address, price, last_price_date) 
							VALUES(?,?,?,?,?,${db.getNow()})`,
							[device_address, userInfo.user_address, userInfo.reddit_user_id, receiving_address, conf.priceInBytes],
							() => {
								resolve({receiving_address: receiving_address, post_publicly: null});
								unlock();
							}
						);
					});
				}
			);
		});
	});
}