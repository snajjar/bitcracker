const WebSocket = require('ws');
const colors = require('colors');
const crypto = require('crypto');
const EventEmitter = require('events');
const _ = require('lodash');
const prompts = require('prompts');
const encryption = require('./encryption');
const Wallet = require('./wallet');
const KrakenRestAPI = require('kraken-api');
const moment = require('moment');
const dotenv = require('dotenv');
const dt = require('./datatools');
const CRC32 = require('crc-32');


class SocketNotConnected extends Error {}

const extractFieldsFromKrakenData = function(arr) {
    return {
        "timestamp": arr[0],
        "open": parseFloat(arr[1]),
        "high": parseFloat(arr[2]),
        "low": parseFloat(arr[3]),
        "close": parseFloat(arr[4]),
        "volume": parseFloat(arr[6]),
    }
}

const sleepms = function(s) {
    return new Promise(resolve => setTimeout(resolve, s));
}

const sleep = function(s) {
    return sleepms(s * 1000);
}

const priceStr = function(p) {
    if (p > 1000) {
        return (p.toFixed(1) + '€')
    } else if (p > 100) {
        return (p.toFixed(2) + '€')
    } else if (p > 10) {
        return (p.toFixed(3) + '€')
    } else if (p > 0) {
        return (p.toFixed(4) + '€')
    } else {
        return new String(p);
    }
};

const price = function(p) {
    return priceStr(p).cyan;
}

const priceYellow = function(p) {
    return priceStr(p).yellow
};

const amount = function(p) {
    return (p.toFixed(4)).cyan
}

const percentage = function(p) {
    return ((p * 100).toFixed(3) + '%').cyan
}

class KrakenWebSocket extends EventEmitter {
    constructor(url = 'wss://ws.kraken.com') {
        super();
        this.assets = [];

        this.url = url;
        this.connected = false;
        this.lastMessageAt = 0;
        this.lastHeartBeat = null;
        this.serverTimeDelay = 0; // default value

        this.cb = {};
        this.prices = {};
        this.books = {};
        this.lastBookMessage = {};
        this.historySize = 1000; // default value

        this.ws = null;
        this.subscriptions = {};

        this.clockTimer = null;
        this._onNewCandle = null; // cb
        this._onDisconnect = null; // cb
        this._onBookSubscriptionChanged = {}; // cb on Book subscription changed for each asset
        this._onOHLCSubscriptionChanged = {}; // cb on OHLC subscription changed for each asset
        this._onFirstBookUpdate = {}; // cb on first book update, for each asset
    }

    setHistorySize(n) {
        this.historySize = n;
        if (this.ws) {
            this.ws.setHistorySize(n);
        }
    }

    setServerTimeDelay(t) {
        this.serverTimeDelay = t; // in ms
    }

    async waitNextMinute() {
        let nextMinute = moment().add(1, "minute").startOf("minute");
        let now = moment();
        if (this.serverTimeDelay < 0) {
            nextMinute.add(-this.serverTimeDelay, "milliseconds");
        } else {
            // wait extra 500ms to be sure
            let waitTime = Math.min(this.serverTimeDelay, 500);
            nextMinute.add(waitTime, "milliseconds");
        }

        let diff = moment.duration(nextMinute - now).asMilliseconds();
        if (diff > 0) {
            await sleepms(diff);
        }
    }

    terminateCurrentCandle(asset) {
        let candle = _.cloneDeep(this.prices[asset].currCandle);

        // connect the candle with the previous one
        let lastCandle = _.last(this.prices[asset].candles);
        dt.connectCandles([lastCandle, candle]);
        this.prices[asset].candles.push(candle);

        // create a new one for the new ticker period
        let newCandleStart = candle.timestamp + 60
        if (this.prices[asset].candles.length > this.historySize) {
            this.prices[asset].candles = this.prices[asset].candles.slice(this.prices[asset].candles.length - this.historySize);
        }
        this.prices[asset].currCandle = {
            timestamp: newCandleStart,
            open: candle.close,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: 0
        }
        this.prices[asset].since = newCandleStart;

        return _.cloneDeep(candle);
    }

    async initClockTimer() {
        if (this.clockTimer) {
            console.log('[*] Clearing previous clock timer');
            this.stopClockTimer();
        }
        await this.waitNextMinute();
        console.log('[*] Launching clock timer');
        this.clockTimer = setInterval(() => {
            this.onClockTick();
        }, 60000);
        this.onClockTick();
    }

    async stopClockTimer() {
        console.log('[*] Stopping clock timer');
        clearInterval(this.clockTimer);
        this.clockTimer = null;
    }

    // end of current candle, start of a new one
    async onClockTick() {
        if (this.checkConnectionAlive()) {
            let currentMinuteTimestamp = moment().startOf('minute').unix();
            let lastMinuteTimestamp = moment().subtract(1, 'minute').startOf('minute').unix();

            // terminate current candle if that wasnt done before
            for (let asset of this.assets) {
                // check first if the prices were initialized
                if (this.prices[asset]) {
                    if (this.prices[asset].currCandle.timestamp !== currentMinuteTimestamp) {
                        this.terminateCurrentCandle(asset);
                    }
                } else {
                    console.log(`[*] ${asset} price update: waiting for OHLC initialisation`);
                }
            }

            for (let asset of this.assets) {
                if (this.prices[asset]) {
                    let lastCandle = _.find(this.prices[asset].candles, candle => candle.timestamp == lastMinuteTimestamp);
                    if (lastCandle == undefined) {
                        //_.each(this.prices[asset].candles, c => console.log(c.timestamp));
                    } else {
                        this._onNewCandle(asset, lastCandle);
                    }
                }
            }

            await this.checkBooksAlive(); // check if all books are still alive
        }
    }

    onNewCandle(cb) {
        this._onNewCandle = cb;
    }

    async addAsset(asset) {
        if (!this.assets.includes(asset)) {
            this.assets.push(asset);
        }

        await this.subscribeOHLC(asset);
        await this.subscribeBook(asset);
    }

    initOHLC(asset, candles, currentCandle, since) {
        this.prices[asset] = {
            candles: candles,
            currCandle: currentCandle,
            since: since
        }
    }

    isOHLCInitialized(asset) {
        return this.prices[asset] !== undefined;
    }

    reset() {
        this.connected = false;
        this.lastMessageAt = 0;
        this.prices = {};
        this.books = {};
        this.lastBookMessage = {};
        this.ws = null;
    }

    disconnect() {
        this.ws.disconnect();
    }

    onDisconnect(cb) {
        this._onDisconnect = cb;
    }

    connect() {
        if (this.connected) {
            return;
        }

        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);
            this.ws.onopen = () => {
                console.log('[*] Connected to Kraken websocket');
                this.connected = true;
                resolve();
            }
            this.ws.onerror = e => {
                console.log(new Date, '[KRAKEN] error', e);
                reject();
            }
            this.ws.onclose = async e => {
                console.log(new Date, '[KRAKEN] closed socket');
                this.stopClockTimer();
                this.reset();
                if (this._onDisconnect) {
                    setTimeout(() => {
                        console.log('[*] Activating disconnection procedure');
                        this._onDisconnect();
                    }, 0);
                }
            }

            // initial book data coming in on the same tick as the subscription data
            // we defer this so the subscription promise resloves before we send
            // initial OB data.
            this.ws.onmessage = e => setImmediate(() => this._handleMessage(e));
        });
    }

    async reconnect() {
        console.log('[*] Reconnecting to websocket');
        await this.connect();
        for (let asset of this.assets) {
            await this.subscribeBook(asset);
            await this.subscribeOHLC(asset);
        }
    }

    checkConnectionAlive() {
        let now = moment();
        let diff = moment.duration(now - this.lastMessageAt).asMilliseconds();
        if (diff > 10000) { // after 10s without message we disconnect
            console.log('[*] Connection lost');
            if (this.ws) {
                this.ws.terminate();
            } else {
                if (this.clockTimer) {
                    clearInterval(this.clockTimer);
                    this.clockTimer = null;
                }
            }
            return false;
        } else {
            //console.log('[*] Connection is alive');
            return true;
        }
    }

    // check that books received at least 1 update in the last 5 minutes
    async checkBooksAlive() {
        let now = moment();
        for (let asset of this.assets) {
            let diff = moment.duration(now - this.lastBookMessage[asset]).asMilliseconds();
            if (diff > 2 * 60000) {
                console.log(`[*] ${asset}: received no book update in 2 minutes. Resetting book`);
                await this.resetBook(asset);
            }
        }
    }

    _handleMessage = e => {
        this.lastMessageAt = moment();
        const payload = JSON.parse(e.data);
        // console.log(payload);

        if (Array.isArray(payload)) {
            // payload is a subscription result
            let subscriptionMessage = {};
            subscriptionMessage.channelId = payload[0];
            subscriptionMessage.data = payload[1];
            subscriptionMessage.channelName = payload[2];
            subscriptionMessage.pair = payload[3];
            this._handleSubscriptionMessage(subscriptionMessage);
        } else {
            switch (payload.event) {
                case "heartbeat":
                    this.onHeartBeat(payload);
                    break;
                case "subscriptionStatus":
                    this.onSubscriptionChanged(payload);
                default:
                    //console.log(JSON.stringify(payload, null, 2));
            }
        }
    }

    onSubscriptionChanged(payload) {
        let pair = _.get(payload, ["pair"]);
        let asset = pair.replace('/EUR', '').replace('EUR', '');
        let type = _.get(payload, ["subscription", "name"]);

        if (type == "book" && this._onBookSubscriptionChanged[asset]) {
            this._onBookSubscriptionChanged[asset](payload);
        } else if (type == "ohlc" && this._onOHLCSubscriptionChanged[asset]) {
            this._onOHLCSubscriptionChanged[asset](payload);
        }
    }

    async _handleSubscriptionMessage(msg) {
        let asset;

        switch (msg.channelName) {
            case "ohlc-1":
                asset = msg.pair.split('/')[0];
                this._handlePriceUpdate(asset, msg);
                break;
            case "book-25":
                asset = msg.pair.split('/')[0];
                if (!this.assets.includes(asset)) {
                    console.log('unknown asset for book update: ' + asset);
                    console.log(JSON.stringify(msg, null, 2));
                } else {
                    await this._handleBookUpdate(asset, msg);
                }
                break;
            default:
                //console.log(JSON.stringify(msg, null, 2));
        }
    }

    _handlePriceUpdate(asset, msg) {
        let data = msg.data;
        //console.log(msg.data);
        let candle = {
            timestamp: parseFloat(data[0]),
            open: parseFloat(data[2]),
            high: parseFloat(data[3]),
            low: parseFloat(data[4]),
            close: parseFloat(data[5]),
            vwap: parseFloat(data[6]),
            volume: parseFloat(data[7]),
        }
        let endTime = parseFloat(data[1]);

        if (endTime < this.prices[asset].currCandle.timestamp) {
            // old candle, sent for verification when no new candle was sent during 1 minute
            // ditch this one
            //console.log(`[*] Ignoring 1 verification candle for asset ${asset}`);
        } else if (endTime == this.prices[asset].currCandle.timestamp) {
            //console.log('THATS THE LAST MINUTE !');
        } else {
            this.prices[asset].currCandle = candle;
            this.prices[asset].currCandle.timestamp = endTime - 60;
        }
    }

    async _handleBookUpdate(asset, msg) {
        let book = _.get(this.books, [asset]);
        this.lastBookMessage[asset] = moment();
        let checksum = null;
        if (!book) {
            // book init
            this.books[asset] = msg.data;
            //console.log(`[*] ${asset} book init`);

            if (this._onFirstBookUpdate[asset]) {
                this._onFirstBookUpdate[asset](asset);
            }

            //console.log('Init book with message: ' + JSON.stringify(msg.data));
            //this.displayOrderBook(asset);
        } else {
            checksum = msg.data.c;
            // console.log(JSON.stringify(msg, null, 2));

            // book update
            _.each(msg.data.a, (newAsk) => {
                let priceStr = newAsk[0];
                let volumeStr = newAsk[1];

                let found = false;
                _.each(this.books[asset].as, (ask) => {
                    // if (!ask) {
                    //     console.error('this should not happen !');
                    //     return;
                    // }

                    let askPrice = ask[0];
                    if (askPrice == priceStr) {
                        // we found the right ask
                        found = true;
                        ask[1] = volumeStr;
                    }
                });

                if (!found) {
                    // this is an insert
                    this.books[asset].as.push(newAsk);
                    this.books[asset].as = _.sortBy(this.books[asset].as, o => parseInt(o[0]));
                }
            });

            _.each(msg.data.b, (newBid) => {
                let priceStr = newBid[0];
                let volumeStr = newBid[1];

                let found = false;
                _.each(this.books[asset].bs, (bid) => {
                    // if (!bid) {
                    //     console.error('this should not happen !');
                    //     return;
                    // }

                    let bidPrice = bid[0];
                    if (bidPrice == priceStr) {
                        // we found the right ask
                        found = true;
                        bid[1] = volumeStr;
                    }
                });

                if (!found) {
                    // this is an insert
                    this.books[asset].bs.push(newBid);
                    this.books[asset].bs = _.filter(this.books[asset].bs, o => o !== undefined);
                    this.books[asset].bs = _.reverse(_.sortBy(this.books[asset].bs, o => parseInt(o[0])));
                }
            });
        }

        // remove lines where volume reach 0
        _.remove(this.books[asset].as, col => parseFloat(col[1]) === 0);
        _.remove(this.books[asset].bs, col => parseFloat(col[1]) === 0);

        // sort again as and bs
        this.books[asset].as = _.sortBy(this.books[asset].as, col => parseFloat(col[0]));
        this.books[asset].bs = _.sortBy(this.books[asset].bs, col => -parseFloat(col[0]));

        let bookChecksum = this.getBookChecksum(asset);
        if (checksum && checksum !== bookChecksum) {
            //this.displayOrderBook(asset);
            if (this.isSubscribed(asset, "book")) {
                // console.error(`[*] Checksum mismatch on book ${asset}: expected ${checksum} but got ${bookChecksum}, reset subscription`);
                await this.resetBook(asset);
            } else {
                // re-subscription must be currently ongoing, do nothing
            }
        }
    }

    getBookChecksum(asset, bookContent) {
        let book = bookContent ? bookContent : this.books[asset];

        let crcInput = "";

        // build the CRC32 key
        // check here: https://docs.kraken.com/websockets/#book-checksum
        // 1. get the top10 ask prices, sorted from low to high
        // 2. Remove dots and leading zeros
        // 3. Add formatted price to string concatenation
        // 4. Repeat step 1->3 but for the volume
        for (var i = 0; i < Math.min(10, book.as.length); i++) {
            let line = book.as[i];
            let price = line[0];
            let priceWithoutDots = price.replace('.', '');
            let priceWithoutTrailingZeros = Number(priceWithoutDots).toString();
            crcInput += priceWithoutTrailingZeros;

            let volume = line[1];
            let volumeWithoutDots = volume.replace('.', '');
            let volumeWithoutTrailingZeros = Number(volumeWithoutDots).toString();
            crcInput += volumeWithoutTrailingZeros;
        }

        // same as before, but for the top10 bids, from high prices to low
        for (var i = 0; i < Math.min(10, book.bs.length); i++) {
            let line = book.bs[i];
            let price = line[0];
            let priceWithoutDots = price.replace('.', '');
            let priceWithoutTrailingZeros = Number(priceWithoutDots).toString();
            crcInput += priceWithoutTrailingZeros;

            let volume = line[1];
            let volumeWithoutDots = volume.replace('.', '');
            let volumeWithoutTrailingZeros = Number(volumeWithoutDots).toString();
            crcInput += volumeWithoutTrailingZeros;
        }

        let crcResult = CRC32.str(crcInput);

        let Uint32Crc = (new Uint32Array([crcResult]))[0]; // cast signed int32 into uint32
        let checksum = Uint32Crc.toString();
        return checksum;
    }

    displayOrderBook(asset) {
        console.log('Bids\t\t\t\t\tAsks');
        let length = Math.max(this.books[asset].as.length, this.books[asset].bs.length);
        for (let i = 0; i < length; i++) {
            let ask = this.books[asset].as[i];
            let bid = this.books[asset].bs[i];
            let askStr = "                       ";
            let bidStr = "                       ";
            if (ask) {
                askStr = `${ask[0].cyan} (${ask[1]})`;
            }
            if (bid) {
                bidStr = `${bid[0].cyan} (${bid[1]})`;
            }
            console.log(`${bidStr}\t\t${askStr}`);
        }

        console.log('Estimate buy price for 2k€ of ETH: ', this.estimateBuyPrice("ETH", 2000));
        console.log('Estimate sell price for 10 ETH: ', this.estimateSellPrice("ETH", 10));
    }

    // return the top value of bidding price
    getTopBiddingPrice(asset) {
        let bids = this.books[asset].bs;
        let bestBid = bids[0];
        return parseFloat(bestBid[0]);
    }

    getTopAskingPrice(asset) {
        let asks = this.books[asset].as;
        let bestAsk = asks[0];
        return parseFloat(bestAsk[0]);
    }

    estimateBuyPrice(asset, currencyVolume) {
        let asks = this.books[asset].as;
        if (asks) {
            let sellers = [];

            for (var i = 0; i < asks.length; i++) {
                let ask = asks[i];
                let askPrice = parseFloat(ask[0]);
                let askVolume = parseFloat(ask[1]);

                if (askPrice * askVolume < currencyVolume) {
                    // we buy everything from this guy
                    sellers.push({
                        price: askPrice,
                        volume: askVolume
                    });
                    currencyVolume -= askPrice * askVolume;
                } else {
                    // we buy what we can from this guy
                    sellers.push({
                        price: askPrice,
                        volume: currencyVolume / askPrice
                    });
                    break;
                }
            }

            if (sellers.length == 1) {
                return sellers[0].price;
            } else {
                // now compute our avg buy price
                let sum = 0;
                let volume = 0;
                _.each(sellers, seller => {
                    sum += seller.price * seller.volume;
                    volume += seller.volume;
                });

                // console.log(JSON.stringify(sellers, null, 2));
                let estimatedBuyPrice = sum / volume || null;
                return estimatedBuyPrice;
            }
        } else {
            return null;
        }
    }

    estimateSellPrice(asset, assetVolume) {
        let bids = this.books[asset].bs;
        if (bids) {
            let buyers = [];

            for (var i = 0; i < bids.length; i++) {
                let bid = bids[i];
                let bidPrice = parseFloat(bid[0]);
                let bidVolume = parseFloat(bid[1]);

                if (assetVolume > bidVolume) {
                    // we sell everything we can to this guy
                    buyers.push({
                        price: bidPrice,
                        volume: bidVolume
                    });

                    assetVolume -= bidVolume;
                } else {
                    // we sell the rest to this guy
                    buyers.push({
                        price: bidPrice,
                        volume: assetVolume
                    });
                    break;
                }
            }

            // now compute our avg buy price
            let sum = 0;
            let volume = 0;
            _.each(buyers, buyer => {
                sum += buyer.price * buyer.volume;
                volume += buyer.volume;
            });

            // console.log(JSON.stringify(buyers, null, 2));

            let estimatedSellPrice = sum / volume || null;
            return estimatedSellPrice;
        } else {
            return null;
        }
    }

    timeout(n) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                reject();
            }, n);
        })
    }

    onHeartBeat() {}

    isSubscribed(asset, subType) {
        let sub = _.get(this.subscriptions, [asset, subType]);
        return sub !== null && sub !== undefined;
    }

    // basic book unsubscription with 5s timeout
    _unsubscribeBook(asset) {
        return Promise.race([
            new Promise(async (resolve, reject) => {
                // delete subscription channelId
                _.set(this.subscriptions, [asset, "book"], null);

                if (!this.ws) {
                    reject(new SocketNotConnected());
                    return;
                }

                await sleep(2);

                // console.log(`[*] Unsubscribing from asset ${asset} book order`);
                this.ws.send(JSON.stringify({
                    "event": "unsubscribe",
                    "pair": [
                        `${asset}/EUR`
                    ],
                    "subscription": {
                        "name": "book",
                    }
                }));

                this._onBookSubscriptionChanged[asset] = (payload) => {
                    let isRightPair = _.get(payload, ["pair"]) == `${asset}/EUR` || _.get(payload, ["pair"]) == `${asset}EUR`;
                    let isBook = _.get(payload, ["subscription", "name"]) == "book";
                    let status = _.get(payload, ["status"]);

                    if (isRightPair && isBook) {
                        if (status === "unsubscribed") {
                            resolve();
                            return;
                        } else if (status === "error") {
                            let errorMessage = _.get(payload, ["errorMessage"]);
                            if (errorMessage.toLowerCase().includes("not found")) {
                                resolve(); // we are already unsubscribed
                                return;
                            }
                        }
                    }

                    console.error('Unexpected book subscription message: ' + JSON.stringify(payload, null, 2));
                    reject();
                };
            }),
            this.timeout(5000)
        ]);
    }

    // basic book subscription with 5s timeout
    _subscribeBook(asset) {
        return Promise.race([
            new Promise(async (resolve, reject) => {
                if (!this.ws) {
                    reject(new SocketNotConnected());
                    return;
                }

                await sleep(2);

                // console.log(`[*] Subscribing to asset ${asset} book order`);
                this.ws.send(JSON.stringify({
                    "event": "subscribe",
                    "pair": [
                        `${asset}/EUR`
                    ],
                    "subscription": {
                        "name": "book",
                        "depth": 25,
                    }
                }));

                this._onBookSubscriptionChanged[asset] = (payload) => {
                    if (payload.status === "subscribed" && payload.pair == `${asset}/EUR` && payload.subscription.name == "book") {
                        this._onBookSubscriptionChanged[asset] = null; // free the cb
                        delete this.lastBookMessage[asset];

                        // reset the asset book
                        this.books[asset] = null;

                        _.set(this.subscriptions, [asset, "book"], payload.channelID);

                        this._onFirstBookUpdate[asset] = (bookAsset) => {
                            if (bookAsset == asset) {
                                this._onFirstBookUpdate[asset] = null; // free the cb
                                // console.log(`[*] subscribed to ${asset} book`);
                                resolve();
                            }
                        };
                    }
                };
            }),
            this.timeout(5000)
        ]);
    }

    async resetBook(asset) {
        await this.unsubscribeBook(asset);
        await sleep(2);
        await this.subscribeBook(asset);
        //this.displayOrderBook(asset);
    }

    // call this._subscribeBook until it works (in case of disconnection)
    async subscribeBook(asset) {
        try {
            await this._subscribeBook(asset);
        } catch (e) {
            if (e instanceof SocketNotConnected) {
                console.log('[*] Giving up book connection: socket closed');
            } else {
                console.log(`[*] retrying book subscription for ${asset}`);
                await this.unsubscribeBook(asset);
                await this.subscribeBook(asset);
            }
        }
    }

    // call this._unsubscribeBook until it works (in case of disconnection)
    async unsubscribeBook(asset) {
        try {
            await this._unsubscribeBook(asset);
        } catch (e) {
            if (e instanceof SocketNotConnected) {
                console.log('[*] Giving up book connection: socket closed');
            } else {
                console.log(`[*] retrying book unsubscription for ${asset}`);
                await this.unsubscribeBook(asset);
            }
        }
    }

    _subscribeOHLC(asset) {
        return Promise.race([
            new Promise(async (resolve, reject) => {
                await sleep(2);

                this.ws.send(JSON.stringify({
                    "event": "subscribe",
                    "pair": [
                        `${asset}/EUR`
                    ],
                    "subscription": {
                        "interval": 1,
                        "name": "ohlc"
                    }
                }));

                this._onOHLCSubscriptionChanged[asset] = (payload) => {
                    if (payload.status === "subscribed" && payload.pair == `${asset}/EUR` && payload.subscription.name == "ohlc") {
                        //console.log(`subscribed to ${asset} book`);
                        _.set(this.subscriptions, [asset, "ohlc"], payload.channelID);
                        this._onOHLCSubscriptionChanged[asset] = null; // free the cb
                        // console.log(`[*] subscribed to ${asset} OHLC`);
                        resolve();
                    }
                };
            }),
            this.timeout(5000)
        ]);
    }

    // basic book unsubscription with 5s timeout
    _unsubscribeOHLC(asset) {
        return Promise.race([
            new Promise(async (resolve, reject) => {
                // delete subscription channelId
                _.set(this.subscriptions, [asset, "book"], null);

                await sleep(2);

                // console.log(`[*] Unsubscribing from asset ${asset} book order`);
                this.ws.send(JSON.stringify({
                    "event": "unsubscribe",
                    "pair": [
                        `${asset}/EUR`
                    ],
                    "subscription": {
                        "interval": 1,
                        "name": "ohlc"
                    }
                }));

                this._onOHLCSubscriptionChanged[asset] = (payload) => {
                    let isRightPair = _.get(payload, ["pair"]) == `${asset}/EUR` || _.get(payload, ["pair"]) == `${asset}EUR`;
                    let isOHLC = _.get(payload, ["subscription", "name"]) == "ohlc";
                    let status = _.get(payload, ["status"]);

                    if (isRightPair && isOHLC) {
                        if (status === "unsubscribed") {
                            resolve();
                            return;
                        } else if (status === "error") {
                            let errorMessage = _.get(payload, ["errorMessage"]);
                            if (errorMessage.toLowerCase().includes("not found")) {
                                resolve(); // we are already unsubscribed
                                return;
                            }
                        }
                    }

                    console.error('Unexpected OHLC subscription message: ' + JSON.stringify(payload, null, 2));
                    reject();
                };
            }),
            this.timeout(5000)
        ]);
    }

    // call this._subscribeOHLC until it works (in case of disconnection)
    async subscribeOHLC(asset) {
        try {
            await this._subscribeOHLC(asset);
        } catch (e) {
            // console.log(`[*] retrying book subscription for ${asset}`);
            await this._unsubscribeOHLC(asset);
            await this.subscribeOHLC(asset);
        }
    }

    // call this._unsubscribeBook until it works (in case of disconnection)
    async unsubscribeOHLC(asset) {
        try {
            await this._unsubscribeOHLC(asset);
        } catch (e) {
            // console.log(`[*] retrying book unsubscription for ${asset}`);
            await this.unsubscribeOHLC(asset);
        }
    }

    displayLastPrices(asset) {
        let p = this.prices[asset];
        let time = moment.unix(p.currCandle.timestamp);
        let candles = p.candles;
        let lastTradedPrice = this.prices[asset].currCandle.close

        console.log(`[WS] ${moment().format('DD/MM/YY hh:mm:ss')} ${asset}: ${price(candles[candles.length-4].close)} -> ` +
            `${price(candles[candles.length-3].close)} -> ` +
            `${price(candles[candles.length-2].close)} -> ` +
            `${price(candles[candles.length-1].close)} -> ` +
            `last_traded=${priceYellow(lastTradedPrice)}`);
    }

    getLastTradedPrice(asset) {
        if (!this.prices[asset] || !this.prices[asset].currCandle) {
            throw new Error("You should first refresh OHLC data before getting current price");
        }
        return this.prices[asset].currCandle.close;
    }

    getPriceCandles(asset) {
        if (!this.prices[asset] || !this.prices[asset].candles) {
            throw new Error("You should first refresh OHLC data before getting candles");
        }
        return _.clone(this.prices[asset].candles);
    }

    getCurrentCandle(asset) {
        if (!this.prices[asset] || !this.prices[asset].currCandle) {
            throw new Error("You should first refresh OHLC data before getting candles");
        }
        return _.clone(this.prices[asset].currCandle);
    }

    getPriceInfos(asset) {
        if (!this.prices[asset] || !this.prices[asset].currCandle) {
            throw new Error("You should first refresh OHLC data before getting candles");
        }
        return _.clone(this.prices[asset]);
    }
}

class KrakenREST {
    constructor(fake) {
        this.fake = fake ? true : false;
        this.kraken = null;
        this.currency = "EUR";
        this.wallet = new Wallet(this.currency);

        // prices data for each asset
        // following format (example):
        // {
        //    "BTC": {
        //       candles: [],      // array of ohlc
        //       currCandle: null, // last ohlc (currently moving)
        //       since: 0,         // last timestamp we refreshed on + 1
        //    }
        //  }
        this.assets = [];
        this.prices = {};
        this.candles = [];
        this.since = 0;
        this.historySize = 1000; // default

        this.placedOrders = []; // history of orders we made

        this.openOrders = {};
        this.closedOrders = {};

        this.tradeVolume = 0;
        this.serverTimeDelay = 0; // number of ms diff between srv and client
        this.lastMinute = null;

        // onNewCandle(asset, candle): cb when a new candle terminate on one of our assets
        this._onNewCandle = null;

        this.ws = null;
    }

    setHistorySize(n) {
        this.historySize = n;
        if (this.ws) {
            this.ws.setHistorySize(n);
        }
    }

    connect() {
        return this.ws.connect();
    }

    async initSocket() {
        console.log('[*] Initializing socket');
        this.ws = new KrakenWebSocket();
        this.ws.setHistorySize(this.historySize);
        this.ws.setServerTimeDelay(this.serverTimeDelay);

        try {
            await this.ws.connect();
        } catch (e) {
            console.log('[*] Failed to connect to websocket, retrying in 10s...');
            setTimeout(() => { this.initSocket(); }, 10000);
            return;
        }
        this.ws.onDisconnect(async () => {
            console.log('[*] Reconnecting to websocket');
            await sleep(2);
            await this.initSocket();
        });
        for (let asset of this.assets) {
            console.log('[*] Initializing asset: ', asset);
            await this.refreshOHLC(asset);
            this.ws.initOHLC(asset, this.prices[asset].candles, this.prices[asset].currCandle, this.prices[asset].since);
            await this.ws.addAsset(asset);
            await sleep(1);
        }
        this.ws.onNewCandle((asset, candle) => {
            if (this._onNewCandle) {
                this._onNewCandle(asset, candle);
            }
        });

        console.log('[*] Initializing clock timer: showing price update every minute');
        await this.ws.initClockTimer();
    }

    async addAsset(asset) {
        if (!this.assets.includes(asset)) {
            this.assets.push(asset);
        }
    }

    onNewCandle(cb) {
        this._onNewCandle = cb;
    }

    estimateSellPrice(asset, assetAmount) {
        let volume = assetAmount ? assetAmount : this.wallet.getAmount(asset);
        return this.ws.estimateSellPrice(asset, volume);
    }

    estimateBuyPrice(asset, currencyAmount) {
        let volume = currencyAmount ? currencyAmount : this.wallet.getCurrencyAmount();
        return this.ws.estimateBuyPrice(asset, volume);
    }

    // get OHLC data for asset "asset"
    // return true if there is new data, false otherwise
    async refreshOHLC(asset) {
        const isNewData = (candles) => {
            if (!this.candles || this.candles.length == 0) {
                return true;
            } else {
                let lastKnownData = _.last(this.candles);
                let lastNewData = _.last(candles);
                return !lastKnownData || lastKnownData.timestamp !== lastNewData.timestamp;
            }
        }

        if (!this.prices[asset]) {
            this.prices[asset] = {
                candles: [],
                currCandle: null,
                since: 0,
            };
        }

        let r = null;
        try {
            // get last prices
            let options = {
                pair: `${asset}${this.currency}`,
                interval: 1,
                since: this.prices[asset].since,
            }
            r = await this.kraken.api('OHLC', options);

            // format data into candles
            let firstKey = _.keys(r.result)[0];
            let results = r.result[firstKey];
            let periods = [];
            _.each(results, r => {
                periods.push(extractFieldsFromKrakenData(r));
            });

            let candles = _.sortBy(periods, p => p.timestamp);
            this.prices[asset].currCandle = candles.pop();
            let lastCandle = _.last(candles);
            if (lastCandle) {
                this.prices[asset].since = lastCandle ? lastCandle.timestamp + 1 : 0; // set the new "since" period
                //console.log(`SET PRICE ${lastCandle.close} for ASSET ${asset}`);
                this.wallet.setPrice(asset, lastCandle.close); // refresh wallet price
                console.log(`[*] ${asset} current price: ${price(lastCandle.close)}`);

                if (!_.isEmpty(candles) && isNewData(candles)) {
                    // there is new data
                    // concat new periods to old ones
                    this.prices[asset].candles = this.prices[asset].candles.concat(candles);
                    if (this.prices[asset].candles.length > this.historySize) {
                        this.prices[asset].candles = this.prices[asset].candles.slice(this.prices[asset].candles.length - this.historySize);
                    }

                    if (!this.ws.isOHLCInitialized(asset)) {
                        this.ws.initOHLC(asset, this.prices[asset].candles, this.prices[asset].currCandle, this.prices[asset].since);
                    }

                    return true;
                } else {
                    return false;
                }
            } else {
                return false;
            }
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error refreshing prices: ' + errorMsg.red);
                console.error(e);
                if (errorMsg.includes("API:Rate limit exceeded")) {
                    console.log('[*] sleeping 10s');
                    await sleep(10);
                }
            } else {
                console.error('Error refreshing prices');
                console.error(e);
                console.log(JSON.stringify(r));
            }
        }
    }

    getLastTradedPrice(asset) {
        return this.ws.getLastTradedPrice(asset);
    }

    getPriceCandles(asset) {
        return this.ws.getPriceCandles(asset);
    }

    getCurrentCandle(asset) {
        return this.ws.getCurrentCandle(asset);
    }

    getPriceInfos(asset) {
        return this.ws.getPriceInfos(asset);
    }

    displayLastPrices(asset) {
        let candles = this.getPriceCandles(asset);
        let estimation = "";
        let lastCandle = _.last(candles);
        if (this.wallet.value(asset) > 10) {
            let marketSellPrice = this.estimateSellPrice(asset);
            let spread = (marketSellPrice - lastCandle.close) / lastCandle.close;
            estimation = `market_sell=${priceYellow(marketSellPrice)} spread=${percentage(spread)}`
        } else {
            let marketBuyPrice = this.estimateBuyPrice(asset);
            let spread = (lastCandle.close - marketBuyPrice) / lastCandle.close;
            estimation = `market_buy=${priceYellow(marketBuyPrice)} spread=${percentage(spread)}`;
        }

        console.log(`[*] ${moment().format('DD/MM/YY hh:mm:ss')} ${asset}: ${price(candles[candles.length-4].close)} -> ` +
            `${price(candles[candles.length-3].close)} -> ` +
            `${price(candles[candles.length-2].close)} -> ` +
            `${price(candles[candles.length-1].close)} -> ` +
            `last_traded=${priceYellow(this.getLastTradedPrice(asset))} ${estimation}`);
    }

    displayAllPrices() {
        console.log('');
        _.each(this.assets, (asset) => {
            let p = this.getPriceInfos(asset);
            let time = moment.unix(p.currCandle.timestamp);
            let candles = p.candles;
            console.log(`[*] ${moment().format('DD/MM/YY hh:mm:ss')} ${asset}: ${price(candles[candles.length-4].close)} -> ` +
                `${price(candles[candles.length-3].close)} -> ` +
                `${price(candles[candles.length-2].close)} -> ` +
                `${price(candles[candles.length-1].close)} -> ` +
                `${priceYellow(this.getLastTradedPrice(asset))} (current candle ${time.format('hh:mm:ss')})`);
        })
        console.log('');
    }

    // get the max BTC volume we can buy with our current EUR wallet
    _getMaxAssetVolume(asset, price) {
        let volumePrecision = this.getVolumePrecision(asset);
        let currencyAmount = this.wallet.getCurrencyAmount();

        // for safety of orders, let's assume asset price increased by 0.05% since we wanted to order
        price = price * 1.0005;

        // adjust volumal precision: 8 decimals for a BTC
        return Math.floor((currencyAmount / price) * Math.pow(10, volumePrecision)) / Math.pow(10, volumePrecision);
    }

    // get the max EUR volume we can get with our current BTC wallet
    _getMaxCurrencyVolume(asset, price) {
        // for safety of orders, let's assume BTC price decreased by 0.1% since last price
        price = price * 0.998;

        // adjust volumal precision: 1 decimals for a EUR. Round it to 0
        return Math.floor(this.wallet.getAmount(asset) * price);
    }

    async login() {
        let envConfig = dotenv.config();
        if (!envConfig || !envConfig.parsed) {
            console.error("You must auth first.".red);
            process.exit(-1);
        }
        let config = envConfig.parsed;
        if (!config.KRAKEN_API_KEY || !config.KRAKEN_SECRET_API_KEY) {
            console.error("You must auth first.".red);
            process.exit(-1);
        }

        const response = await prompts({
            type: 'password',
            name: 'password',
            message: 'password',
            validate: value => value.length < 8 ? `password is at least 8 chararacters` : true
        });
        let password = await response.password;

        // decrypt api key, secret key, and login to kraken
        let apiKey = encryption.decrypt(config.KRAKEN_API_KEY, password);
        let secretApiKey = encryption.decrypt(config.KRAKEN_SECRET_API_KEY, password);

        // console.log("apiKey:", apiKey);
        // console.log("secretAPIKey: ", secretApiKey);

        try {
            this.kraken = new KrakenRestAPI(apiKey, secretApiKey);
        } catch (e) {
            console.error("Auth failed, incorrect password".red);
            process.exit(-1);
        }

        // check if we logged in successfully but retrieving balance
        try {
            // get balance info
            let r = await this.kraken.api('Balance');

            _.each(r.result, (amountStr, key) => {
                let name = key;
                if (name.length == 4 && (name[0] == 'X' || name[0] == 'Z')) {
                    // kraken sometimes prefix with 'X' for cryptos and 'Z' for currencies
                    name = name.substr(1);
                }
                let amount = parseFloat(amountStr);
                this.wallet.setAmount(name, amount);
            });
        } catch (e) {
            console.error('It appears that you are not logged in correctly'.red);
            throw e;
        }
    }

    async getServerTime() {
        let r = null;
        try {
            // get balance info
            r = await this.kraken.api('Time');
            let time = parseInt(r.result["unixtime"]);
            return time;
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error retrieving account balance: ' + errorMsg.red);
                console.error(e);
            } else {
                console.error('Error retrieving account balance');
                console.error(e);
                console.log(JSON.stringify(r));
            }
        }
    }

    // save difference between local time and server time
    async synchronize() {
        // server time synchronisation
        let serverTime = await this.getServerTime();
        let diff = moment() - moment.unix(serverTime);
        this.serverTimeDelay = diff % 60000;
        if (this.ws) {
            this.ws.setServerTimeDelay(this.serverTimeDelay);
        }
        console.log(`[*] Time synchronisation: ${this.serverTimeDelay}ms`);
    }

    // required synchronisation
    async nextMinute() {
        if (!this.lastMinute) {
            this.lastMinute = moment();
        }

        let nextMinute = moment().add(1, "minute").startOf("minute");
        if (this.serverTimeDelay < 0) {
            nextMinute.add(-this.serverTimeDelay, "milliseconds");
        }

        let diff = moment.duration(nextMinute - this.lastMinute).asMilliseconds();
        if (diff > 0) {
            await sleepms(diff);
        }

        this.lastMinute = moment();
    }

    // return when there is a new price data available
    async nextData(asset) {
        // let since = _.get(this.prices, [asset, "since"]) || 0;
        // let startOfLastMinute = moment().subtract(1, 'minute').subtract(1, 'second').startOf('minute');
        // let lastAssetRefresh = moment.unix(since);

        // // if last refresh happened in this minute, wait for the next minute
        // if (startOfLastMinute.isBefore(lastAssetRefresh)) {
        //     await this.nextMinute();
        // }

        let newDataAvailable = await this.refreshOHLC(asset);
        while (!newDataAvailable) {
            //console.log(`[*] Last data for ${asset} at ${lastAssetRefresh.format('DD/MM/YYYY HH:mm:ss')}, now ${moment().format('DD/MM/YYYY HH:mm:ss')}, retrying...`);
            await sleep(1);
            newDataAvailable = await this.refreshOHLC(asset);
        }
    }

    async refreshBalance() {
        let r = null;
        try {
            // get balance info
            r = await this.kraken.api('Balance');
            _.each(r.result, (amountStr, assetName) => {
                if (assetName.length == 4 && (assetName[0] == 'X' || assetName[0] == 'Z')) {
                    // remove Kraken 'X' prefix (cryptos) or 'Z' prefix (currencies)
                    assetName = assetName.substr(1);
                }

                this.wallet.setAmount(assetName, parseFloat(amountStr));
            });
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error retrieving account balance: ' + errorMsg.red);
                console.error(e);
            } else {
                console.error('Error retrieving account balance');
                console.error(e);
                console.log(JSON.stringify(r));
            }
        }
    }

    async refreshOpenOrders() {
        let r = null;
        try {
            // get balance info
            r = await this.kraken.api('OpenOrders');
            this.openOrders = r.result.open;
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error retrieving account orders: ' + errorMsg.red);
            } else {
                console.error('Error retrieving account orders');
                console.error(e);
                console.log(JSON.stringify(r));
            }
        }
    }

    async refreshClosedOrders() {
        let r = null;
        try {
            // get balance info
            r = await this.kraken.api('ClosedOrders');
            //console.log(JSON.stringify(r));
            this.closedOrders = r.result.closed;
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error retrieving account orders: ' + errorMsg.red);
            } else {
                console.error('Error retrieving account orders');
                console.error(e);
                console.log(JSON.stringify(r));
            }
        }
    }

    async refreshTradeVolume() {
        let r = null;
        try {
            // get balance info
            r = await this.kraken.api('TradeVolume');
            this.tradeVolume = parseFloat(r.result.volume);
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error retrieving account orders: ' + errorMsg.red);
            } else {
                console.error('Error retrieving account orders');
                console.error(e);
                console.log(JSON.stringify(r));
            }
        }
    }

    getPairKey(asset) {
        return `${asset}${this.currency}`;
    }

    async buyAll(asset, currentAssetPrice) {
        let r = null;

        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: this.getPairKey(asset),
            type: 'buy',
            ordertype: 'market',
            volume: this._getMaxAssetVolume(asset, currentAssetPrice),
            expiretm: "+60", // expire in 60s,
            userref: userref, // reference for order, to be used internally
        }
        if (this.fake) {
            options.validate = true; // validate input only, do not submit order !
        }

        try {
            // get balance info
            r = await this.kraken.api('AddOrder', options);
            console.log(`[*] placed ${this.fake ? "(FAKE)": ""} BUY order: ${r.result.descr.order}`);
            this.placedOrders.push({ order: options, result: r.result });
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error while buying: ' + errorMsg.red);
            } else {
                console.error('Error while buying'.red);
                console.error(e);
                console.log(JSON.stringify(r));
            }

            console.log('[*] BUY failed. Try to bid instead');
            await this.bidAll(asset, currentAssetPrice);
            //process.exit(-1);
        }
    }

    async sellAll(asset, currentAssetPrice) {
        let r = null;

        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: this.getPairKey(asset),
            type: 'sell',
            ordertype: 'market',
            volume: this.wallet.getAmount(asset),
            expiretm: "+60", // expire in 60s,
            userref: userref, // reference for order, to be used internally
        }
        if (this.fake) {
            options.validate = true; // validate input only, do not submit order !
        }

        try {
            // get balance info
            r = await this.kraken.api('AddOrder', options);
            console.log(`[*] placed ${this.fake ? "(FAKE)": ""} SELL order: ${r.result.descr.order}`);
            this.placedOrders.push({ order: options, result: r.result });
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error while selling: ' + errorMsg.red);
            } else {
                console.error('Error while selling'.red);
                console.error(e);
                console.log(JSON.stringify(r));
            }

            console.log('[*] SELL failed. Try to ask instead');
            await this.askAll(asset, currentAssetPrice);
            //process.exit(-1);
        }
    }

    getPricePrecision(asset) {
        // see https://support.kraken.com/hc/en-us/articles/360001389366-Price-and-volume-decimal-precision
        let pricePrecision = {
            "ADA": 6,
            "XBT": 1,
            "XRP": 5,
            "BCH": 1,
            "ETH": 2,
            "LTC": 2,
            "DASH": 3,
        }

        return pricePrecision[asset] || 6;
    }

    getVolumePrecision(asset) {
        // see https://support.kraken.com/hc/en-us/articles/360001389366-Price-and-volume-decimal-precision
        return 8;
    }


    // bidding is like buying, but at a limit price, expiration in 55 seconds
    // (to be sure it's expired when next period starts)
    // we use post limit order to make sure we get the maker fees
    async bidAll(asset, price) {
        let r = null;

        // the trader wants to bid at the specified price, but we know the book order
        // meaning that we may be able to do better than that
        // take the best bid on it, and see if it still matches our price
        let bestBidPrice = this.ws.getTopBiddingPrice(asset);
        if (bestBidPrice <= price) {
            console.log(`[*] Adjusting bidding price from ${price} to ${bestBidPrice} based on book updates`);
            price = bestBidPrice;
        }

        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: this.getPairKey(asset),
            type: 'buy',
            ordertype: 'limit',
            volume: this._getMaxAssetVolume(asset, price),
            expiretm: "+55", // expire in 50s,
            oflags: "post",
            price: price.toFixed(this.getPricePrecision(asset)),
            userref: userref, // reference for order, to be used internally
        }
        if (this.fake) {
            options.validate = true; // validate input only, do not submit order !
        }

        try {
            // get balance info
            r = await this.kraken.api('AddOrder', options);
            console.log(`[*] placed ${this.fake ? "(FAKE)": ""} BUY order: ${r.result.descr.order}`);
            this.placedOrders.push({ order: options, result: r.result });
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error while bidding: ' + errorMsg.red);
            } else {
                console.error('Error while bidding'.red);
                console.error(e);
                console.log(JSON.stringify(r));
            }
            //process.exit(-1);
        }
    }

    async askAll(asset, price) {
        let r = null;

        // the trader wants to bid at the specified price, but we know the book order
        // meaning that we may be able to do better than that
        // take the best bid on it, and see if it still matches our price
        let bestAskPrice = this.ws.getTopAskingPrice(asset);
        if (bestAskPrice <= price) {
            console.log(`[*] Adjusting asking price from ${price} to ${bestAskPrice} based on book updates`);
            price = bestAskPrice;
        }

        // reference that order, we never know
        let userref = Math.floor(Math.random() * 1000000000);
        let options = {
            pair: this.getPairKey(asset),
            type: 'sell',
            ordertype: 'limit',
            volume: this.wallet.getAmount(asset),
            expiretm: "+55", // expire in 50s,
            oflags: "post",
            price: price.toFixed(this.getPricePrecision(asset)),
            userref: userref, // reference for order, to be used internally
        }
        if (this.fake) {
            options.validate = true; // validate input only, do not submit order !
        }

        try {
            // get balance info
            r = await this.kraken.api('AddOrder', options);
            console.log(`[*] placed ${this.fake ? "(FAKE)": ""} SELL order: ${r.result.descr.order}`);
            this.placedOrders.push({ order: options, result: r.result });
        } catch (e) {
            let errorMsg = _.get(r, ['data', 'error', 0]);
            if (errorMsg) {
                console.error('Error while asking: ' + errorMsg.red);
            } else {
                console.error('Error while asking'.red);
                console.error(e);
                console.log(JSON.stringify(r));
            }
            //process.exit(-1);
        }
    }

    async refreshAccount() {
        this.refreshTradeVolume();
        await sleep(1);

        await this.refreshBalance();
        await sleep(1);

        await this.refreshOpenOrders();
        await sleep(2);

        await this.refreshClosedOrders();
        await sleep(2);
    }

    hasOpenOrders() {
        return _.keys(this.openOrders).length > 0;
    }

    displayBalance() {
        this.wallet.display();
    }

    displayOpenOrders() {
        console.log(`- ${_.keys(this.openOrders).length.toString().cyan} open orders`);
        _.each(this.openOrders, (o, key) => {
            console.log(`   - ${key}: ${o.descr.order}`);
        });
    }

    displayClosedOrders() {
        console.log(`- ${_.keys(this.closedOrders).length.toString().cyan} closed orders (last 10):`);
        let sortedClosedOrders = _.sortBy(this.closedOrders, o => o.closetm);
        let lastOrders = _.slice(sortedClosedOrders, sortedClosedOrders.length - 10);
        _.each(_.reverse(lastOrders), (o, key) => {
            if (o.price > 0) {
                console.log(`   - ${key}: ${o.descr.order} (price: ${o.price})`);
            } else {
                console.log(`   - ${key}: ${o.descr.order}`);
            }
        });
    }

    lastBuyPrice() {
        let buys = _.filter(this.closedOrders, o => o.descr.type == "buy");
        let sortedBuys = _.sortBy(buys, o => o.closetm);
        let lastBuy = _.last(sortedBuys);
        return parseFloat(lastBuy.price);
    }

    getCurrentTradesInfos() {
        let infos = {};
        let buys = _.filter(this.closedOrders, o => o.descr.type == "buy");
        let sortedBuys = _.sortBy(buys, o => o.closetm);
        sortedBuys = _.reverse(sortedBuys);

        _.each(_.keys(this.wallet.assets), asset => {
            if (this.wallet.value(asset) > 10 && asset !== this.wallet.getMainCurrency()) {
                // retrieve the buy price from the last orders
                let buy = _.find(sortedBuys, b => b.descr.pair == `${asset}EUR`);
                let buyPrice = parseFloat(buy.price);
                infos[asset] = {
                    "enterPrice": buyPrice,
                    "enterTimestamp": parseInt(buy.closetm),
                }
            }
        });

        //return parseFloat(lastBuy.price);
        return infos;
    }

    lastSellPrice() {
        let buys = _.filter(this.closedOrders, o => o.descr.type == "sell");
        let sortedBuys = _.sortBy(buys, o => o.closetm);
        let lastSell = _.last(sortedBuys);
        return parseFloat(lastSell.price);
    }

    displayAccount() {
        console.log('-----------------------------------------------------------------------------');
        console.log(' Current account status: ');
        this.displayBalance();
        this.displayOpenOrders();
        this.displayClosedOrders();
        console.log('-----------------------------------------------------------------------------');
    }
}


var main = async function() {
    //let assets = ["XBT", "XRP", "DASH"];
    let assets = ["ETH"];

    let k = new KrakenREST();
    k.kraken = new KrakenRestAPI();
    for (let asset of assets) {
        await k.addAsset(asset);
    }
    k.wallet.setAmount('EUR', 1000);
    await k.synchronize(); // get server time delay
    k.setHistorySize(10);

    k.onNewCandle((asset, candle) => {
        let lastTraded = candle.close;
        let marketBuy = k.estimateBuyPrice(asset, 1000);
        let marketSell = k.estimateSellPrice(asset, 5);

        console.log(`marketSell=${price(marketSell)} lastTraded=${price(lastTraded)} marketBuy=${price(marketBuy)}`);
        k.ws.displayOrderBook(asset);
    });
    await k.initSocket();

    // k.ws.getBookChecksum("ETH", {
    //     "as": [
    //         ["0.05005", "0.00000500", "1582905487.684110"],
    //         ["0.05010", "0.00000500", "1582905486.187983"],
    //         ["0.05015", "0.00000500", "1582905484.480241"],
    //         ["0.05020", "0.00000500", "1582905486.645658"],
    //         ["0.05025", "0.00000500", "1582905486.859009"],
    //         ["0.05030", "0.00000500", "1582905488.601486"],
    //         ["0.05035", "0.00000500", "1582905488.357312"],
    //         ["0.05040", "0.00000500", "1582905488.785484"],
    //         ["0.05045", "0.00000500", "1582905485.302661"],
    //         ["0.05050", "0.00000500", "1582905486.157467"]
    //     ],
    //     "bs": [
    //         ["0.05000", "0.00000500", "1582905487.439814"],
    //         ["0.04995", "0.00000500", "1582905485.119396"],
    //         ["0.04990", "0.00000500", "1582905486.432052"],
    //         ["0.04980", "0.00000500", "1582905480.609351"],
    //         ["0.04975", "0.00000500", "1582905476.793880"],
    //         ["0.04970", "0.00000500", "1582905486.767461"],
    //         ["0.04965", "0.00000500", "1582905481.767528"],
    //         ["0.04960", "0.00000500", "1582905487.378907"],
    //         ["0.04955", "0.00000500", "1582905483.626664"],
    //         ["0.04950", "0.00000500", "1582905488.509872"]
    //     ]
    // });

}

if (require.main === module) {
    main();
}

module.exports = KrakenREST;