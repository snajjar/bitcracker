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
        return (p.toFixed(0) + '€')
    } else if (p > 100) {
        return (p.toFixed(1) + '€')
    } else if (p > 10) {
        return (p.toFixed(2) + '€')
    } else {
        return (p.toFixed(3) + '€')
    }
};

const price = function(p) {
    return priceStr(p).cyan;
}

const priceYellow = function(p) {
    return priceStr(p).yellow
};

const amount = function(p) {
    return (p.toFixed(3)).cyan
}

class KrakenWebSocket extends EventEmitter {
    constructor(url = 'wss://ws.kraken.com') {
        super();

        this.url = url;
        this.connected = false;
        this.lastMessageAt = 0;

        this.prices = {};
        this.books = {};

        this.ws = null;

        this.onConnect = null;
    }

    disconnect() {
        this.ws.disconnect();
    }

    connect() {
        if (this.connected) {
            return;
        }

        return new Promise((resolve) => {
            this.ws = new WebSocket(this.url);
            this.ws.onopen = () => {
                this.connected = true;
                resolve();
            }
            this.ws.onerror = e => {
                console.log(new Date, '[KRAKEN] error', e);
            }
            this.ws.onclose = async e => {
                console.log(new Date, '[KRAKEN] close', e);
                await sleep(5);
                console.log('[*] Reconnecting');
                await this.connect();
            }

            // initial book data coming in on the same tick as the subscription data
            // we defer this so the subscription promise resloves before we send
            // initial OB data.
            this.ws.onmessage = e => setImmediate(() => this._handleMessage(e));
        });
    }

    _handleMessage = e => {
        this.lastMessageAt = new Date();
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
                case "heartbeart":
                    this.onHeartBeat(payload);
                    break;
                default:
                    // console.log(JSON.stringify(payload, null, 2));
            }
        }
    }

    _handleSubscriptionMessage(msg) {
        // console.log(JSON.stringify(msg, null, 2));
        let asset;

        switch (msg.channelName) {
            case "ohlc-1":
                asset = msg.pair.split('/')[0];
                this._handlePriceUpdate(asset, msg);
                break;
            case "book-10":
                asset = msg.pair.split('/')[0];
                this._handleBookUpdate(asset, msg);
                break;
            default:
                // console.log(JSON.stringify(msg, null, 2));
        }

    }

    _handlePriceUpdate(asset, msg) {

    }

    _handleBookUpdate(asset, msg) {
        let book = _.get(this.books, [asset]);
        if (!book) {
            // book init
            this.books[asset] = msg.data;
            console.log(`[*] ${asset} book init`);
        } else {
            // book update
            _.each(msg.data.a, (newAsk) => {
                let priceStr = newAsk[0];
                let volumeStr = newAsk[1];
                let volume = parseFloat(volumeStr);

                let found = false;
                _.each(this.books[asset].as, (ask) => {
                    if (!ask) {
                        return;
                    }

                    let askPrice = ask[0];
                    if (askPrice == priceStr) {
                        // we found the right ask
                        found = true;
                        if (volume == 0) {
                            // this is a delete message
                            _.remove(this.books[asset].as, a => a == ask)
                        } else {
                            ask[1] = volumeStr;
                        }
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
                let volume = parseFloat(volumeStr);

                let found = false;
                _.each(this.books[asset].bs, (bid) => {
                    if (!bid) {
                        return;
                    }
                    let bidPrice = bid[0];
                    if (bidPrice == priceStr) {
                        // we found the right ask
                        found = true;
                        if (volume == 0) {
                            // this is a delete message
                            _.remove(this.books[asset].bs, b => b == bid)
                        } else {
                            bid[1] = volumeStr;
                        }
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

        //this.displayOrderBook(asset);
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

        console.log('Estimate buy price for 80k€: ', this.estimateBuyPrice("XBT", 80000));
        console.log('Estimate sell price for 10 BTC: ', this.estimateSellPrice("XBT", 10));
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
        if (!this.books[asset]) {
            console.log(`${asset} is not in the book !`);
            console.log(`We have ${_.keys(this.books)} in it`);
        }

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

            // now compute our avg buy price
            let sum = 0;
            let volume = 0;
            _.each(sellers, seller => {
                sum += seller.price * seller.volume;
                volume += seller.volume;
            });

            // console.log(JSON.stringify(sellers, null, 2));

            return sum / volume;
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

            return sum / volume;
        } else {
            return null;
        }
    }

    onHeartBeat() {

    }

    subscribeBook(asset) {
        // console.log(`[*] Subscribing to asset ${asset}`);

        this.ws.send(JSON.stringify({
            "event": "subscribe",
            "pair": [
                `${asset}/EUR`
            ],
            "subscription": {
                "name": "book",
                //"depth": 50,
            }
        }));
    }

    subscribeOHLC(asset) {
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
        this.prices = {};
        this.candles = [];
        this.currCandle = null;
        this.since = 0;

        this.placedOrders = []; // history of orders we made

        this.openOrders = {};
        this.closedOrders = {};

        this.tradeVolume = 0;
        this.serverTimeDelay = 0; // number of ms diff between srv and client
        this.lastMinute = null;

        this.ws = new KrakenWebSocket();
        this.ws.connect();
    }

    addAsset(asset) {
        this.ws.subscribeBook(asset);
    }

    estimateSellPrice(asset) {
        let volume = this.wallet.getAmount(asset);
        return this.ws.estimateSellPrice(asset, volume);
    }

    estimateBuyPrice(asset) {
        let volume = this.wallet.getCurrencyAmount();
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

                if (!_.isEmpty(candles) && isNewData(candles)) {
                    // there is new data
                    // concat new periods to old ones
                    this.prices[asset].candles = this.prices[asset].candles.concat(candles);
                    if (this.prices[asset].candles.length > 1000) {
                        this.prices[asset].candles = this.prices[asset].candles.slice(this.prices[asset].candles.length - 1000);
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

    displayLastPrices(asset) {
        let p = this.prices[asset];
        let time = moment.unix(p.currCandle.timestamp);
        let candles = p.candles;
        let estimation = "";
        if (this.wallet.getMaxAsset() == asset) {
            let marketSellPrice = this.estimateSellPrice(asset);
            estimation = `market_sell=${priceYellow(marketSellPrice)}`
        } else {
            let marketBuyPrice = this.estimateBuyPrice(asset);
            estimation = `market_buy=${priceYellow(marketBuyPrice)}`;
        }

        console.log(`[*] ${moment().format('DD/MM/YY hh:mm:ss')} ${asset}: ${price(candles[candles.length-4].close)} -> ` +
            `${price(candles[candles.length-3].close)} -> ` +
            `${price(candles[candles.length-2].close)} -> ` +
            `${price(candles[candles.length-1].close)} -> ` +
            `last_traded=${priceYellow(this.getLastTradedPrice(asset))} ${estimation}`);
    }

    displayAllPrices() {
        console.log('');
        _.each(this.prices, (p, asset) => {
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
        this.serverTimeDelay = diff % 60000 - 200; // remove 200ms for ping delay
        console.log(`[*] Time synchronisation: ${this.serverTimeDelay}ms`);
    }

    // required synchronisation
    async nextMinute() {
        if (!this.lastMinute) {
            this.lastMinute = moment();
        }

        let nextMinute = moment().add(1, "minute").startOf("minute");
        if (this.serverTimeDelay > 0) {
            nextMinute.add(this.serverTimeDelay, "milliseconds");
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
            expiretm: "+50", // expire in 50s,
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
            expiretm: "+50", // expire in 50s,
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
        let buys = _.sortBy(this.closedOrders, o => o.descr.type == "buy");
        let sortedBuys = _.sortBy(buys, o => o.closetm);
        let lastBuy = _.last(sortedBuys);
        return lastBuy.price;
    }

    lastSellPrice() {
        let buys = _.sortBy(this.closedOrders, o => o.descr.type == "sell");
        let sortedBuys = _.sortBy(buys, o => o.closetm);
        let lastSell = _.last(sortedBuys);
        return lastSell.price;
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
    let krakenws = new KrakenWebSocket();
    await krakenws.connect();
    krakenws.subscribeBook("XBT");

    while (1) {
        await sleep(5);
        krakenws.displayOrderBook("XBT");
    }
}

if (require.main === module) {
    main();
}

module.exports = KrakenREST;