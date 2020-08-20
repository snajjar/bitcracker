const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');
const dt = require('../lib/datatools');
const moment = require('moment');

class ChampionTrader extends Trader {
    constructor() {
        super();

        // EMA triggers we react to
        this.emaPeriods = 2;
        this.emaDownTrigger = { 'min': 0.23, 'max': 0.4 };
        this.emaUpTrigger = { 'min': 0.15, 'max': 0.33 };

        // SMA
        this.smaPeriods = 3;

        // Trader will also scalp shortly after a buy
        this.timeInTrade = null;
        this.winTradePeriod = { 'min': 60, 'max': 60 * 24 };

        // scalp profit for short time trades and long times
        // ie: if we can sell quickly, use shortWindowScalpProfit, else use longWindowScalpProfit
        this.longWindowScalpProfit = { 'min': 0.003, 'max': 0.006 };

        // how close we are to the highest value of the analysis interval
        this.volatilityRange = 0.5;
        this.volatilityFactor = 4.2; // to power of 4

        // if we get to the lowest 4% of the price amplitude of history (and if the asset is volatile enough), let's buy
        this.minZoneVolatility = 1.025;
        this.zoneTreshold = 0.04;
        this.zoneMinTrendCoeff = -0.7; // if price are doing worse than something like f(x) = -0.7x + b, don't buy
    }

    getScalpProfit() {
        return this.longWindowScalpProfit;
    }

    analysisIntervalLength() {
        return 700;
    }

    hash() {
        return "Algo_Champion6";
    }

    // return the current value for position (between 0 and 1), on a logarithmic scale from min to max
    logSlider(min, max, ratio) {
        let minv = Math.log(min);
        let maxv = Math.log(max);
        let scale = (maxv - minv) / (max - min);
        let position = this.linearSlider(min, max, ratio);
        return Math.exp(minv + scale * (position - min));
    }

    linearSlider(min, max, ratio) {
        let range = max - min;
        return min + range * ratio;
    }

    getTaxRatio() {
        let taxRange = 0.0016 * 2;
        let curr = this.getBuyTax() - 0.001 + this.getSellTax() - 0.001;
        return curr / taxRange;
    }

    adaptativeEMADownTrigger(candles) {
        // adjust thoses triggers to the asset volatility
        let assetVolatility = this.getAssetVolatility(candles);
        let volatilityFactor = Math.pow(assetVolatility, this.volatilityFactor);
        return this.logSlider(this.emaDownTrigger.min * volatilityFactor, this.emaDownTrigger.max * volatilityFactor, this.getTaxRatio());
    }

    adaptativeEMAUpTrigger(candles) {
        // adjust thoses triggers to the asset volatility
        let assetVolatility = this.getAssetVolatility(candles);
        let volatilityFactor = Math.pow(assetVolatility, this.volatilityFactor);
        return this.logSlider(this.emaUpTrigger.min * volatilityFactor, this.emaUpTrigger.max * volatilityFactor, this.getTaxRatio());
    }

    adaptativeScalp() {
        let scalpProfit = this.getScalpProfit();
        return this.logSlider(scalpProfit.min, scalpProfit.max, this.getTaxRatio());
    }

    getAdaptativeWinTradePeriod() {
        return this.logSlider(this.winTradePeriod.min, this.winTradePeriod.max, this.getTaxRatio());
    }

    getEMA(dataPeriods) {
        let candles = dataPeriods.slice(dataPeriods.length - 28);
        let closePrices = _.map(candles, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.ema.indicator([closePrices], [this.emaPeriods], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    getSMA(dataPeriods) {
        let candles = dataPeriods.slice(dataPeriods.length - 42);
        let closePrices = _.map(candles, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.ema.indicator([closePrices], [this.smaPeriods], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    getHighest(candles) {
        return _.maxBy(candles, o => o.high).high;
    }

    getLowest(candles) {
        return _.minBy(candles, o => o.low).low;
    }

    getBidWinningPrice() {
        return this.enterTradeValue * (1 + this.getBuyTax() + this.getAskTax());
    }

    // return a percentage of how much the action moved compared to it's price
    getAssetVolatility(candles) {
        let highest = this.getHighest(candles);
        let lowest = this.getLowest(candles);
        let volatility = 1 + (highest - lowest) / highest;
        return volatility;
    }

    // expected more than 87.5% return, set stoploss at 8x gain (counting taxes too)
    getStopLossRatio(targetProfit) {
        return targetProfit * 8 - this.getBidTax() * 2;
    }

    getMACD(candles) {
        let closePrices = _.map(candles, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.macd.indicator([closePrices], [10, 26, 9], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    }

    async getADX5(candles) {
        let merged = dt.mergeCandlesBy(candles, 5);
        return await this.getADX(merged);
    }

    getADX(candles) {
        let highPrices = _.map(candles, p => p.high);
        let lowPrices = _.map(candles, p => p.low);
        let closePrices = _.map(candles, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.adx.indicator([highPrices, lowPrices, closePrices], [14], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    async isTrendStrong(candles) {
        let merged = dt.mergeCandlesBy(candles, 5);
        let adx = await this.getADX(merged);
        let lastADX = _.last(adx);
        let ADXTrendSeemsStrong = !isNaN(lastADX) && lastADX > 50;

        let [macd, signal, histo] = await this.getMACD(candles);
        let lastMACD = _.last(macd);
        let lastSignal = _.last(signal);
        let MACDTrendSeemsStrong = Math.abs(lastMACD - lastSignal) > 2;

        return ADXTrendSeemsStrong && MACDTrendSeemsStrong;
    }

    async getTrendDirections(candles) {
        let frameTrendDirections = [];

        // linear reg on the 1, 5, 15, 60 intervals
        for (let intervalLength of [60, 15, 5, 1]) {
            let sliced = candles.slice(this.analysisIntervalLength() % intervalLength);
            let mergedCandles = dt.mergeCandlesBy(sliced, intervalLength);
            let sma = await this.getSMA(mergedCandles);
            let last5SMA = sma.slice(sma.length - 5);
            let [a, b] = dt.linearRegression(_.range(last5SMA.length), last5SMA);
            frameTrendDirections.push(a);
        }

        // console.log(frameTrendDirections);
        return frameTrendDirections;
    }

    async sellProcedure(asset, candles, price) {
        // use ADX indicator to determine if the current upward trend is strong
        // if yes, hold our position a little bit longer
        // if no, sell now
        let strongTrend = await this.isTrendStrong(candles);
        if (strongTrend) {
            // console.log(`should sell at ${price.lastTraded} but hold`);
            return this.hold();
        } else {
            // console.log(`finally sell at ${price.lastTraded}`);
            return this.sell();
        }
    }

    getObjective() {
        return this.getSellWinningPrice() * (1 + this.adaptativeScalp());
    }

    getStopLoss() {
        let riskRatio = (this.currentTrade.enterPrice / this.getObjective());
        let stopLossRatio = riskRatio - this.getBidTax() - this.getSellTax();
        return this.currentTrade.enterPrice * stopLossRatio;
    }

    getCurrentTimestamp(candles) {
        let lastCandle = _.last(candles);
        if (lastCandle.timestamp) {
            return lastCandle.timestamp;
        } else {
            return moment().unix();
        }
    }

    // decide for an action
    async action(asset, candles, price) {
        // calculate sma indicator
        try {
            let ema = await this.getEMA(candles);
            let currEMA = _.last(ema);

            let highest = this.getHighest(candles);
            let lowest = this.getLowest(candles);
            let amplitude = highest - lowest;

            if (!this.isInTrade()) {
                let emadiff = (price.marketBuy / currEMA * 100) - 100;
                let bidtaxdiff = (this.getBuyTax() - this.getBidTax());
                let emabiddiff = (price.marketBuy * (1 - bidtaxdiff) / currEMA * 100) - 100;

                let priceTreshold = lowest + amplitude * this.volatilityRange;
                if (price.marketBuy > priceTreshold) {
                    // console.log('close to all time high, hold');
                    return this.hold();
                }

                if (emadiff < -this.adaptativeEMADownTrigger(candles)) {
                    // BUY condition
                    this.timeInTrade = 0;
                    this.log('BUY after price drop');
                    return this.buy();
                    //return this.bid(price.lastTraded);
                } else if (emabiddiff < -this.adaptativeEMADownTrigger(candles)) {
                    this.log('BID after small price drop');
                    return this.bid(price.marketBuy);
                } else {
                    let assetVolatility = this.getAssetVolatility(candles);
                    // console.log(`${asset} volatility: ${assetVolatility}`);
                    let inBuyZone = assetVolatility > this.minZoneVolatility && price.marketBuy < lowest + amplitude * this.zoneTreshold;
                    if (inBuyZone) {
                        // let trendDirections = await this.getTrendDirections(candles);
                        // let minDirection = _.min(trendDirections);
                        // if (minDirection > this.zoneMinTrendCoeff) {
                        //     this.log('BID when price range in buy zone, trend direction: ' + trendDirections);
                        //     return this.bid(price.lastTraded);
                        // } else {
                        //     // console.log('Trend directions not good enough: ', trendDirections);
                        //     return this.hold();
                        // }

                        // let adx = await this.getADX5(candles);
                        // let lastADX = _.last(adx);
                        // if (lastADX > 30) {
                        //     return this.hold();
                        // } else {
                        //     return this.bid(price.lastTraded);
                        // }

                        let trendDirections = await this.getTrendDirections(candles);
                        let minDirection = _.min(trendDirections);
                        if (minDirection > -0.7) {
                            return this.bid(price.marketBuy);
                        } else {
                            return this.hold();
                        }
                    } else {
                        return this.hold();
                    }
                    // return this.hold();
                }
            } else {
                let emadiff = (price.marketSell / currEMA * 100) - 100;
                let bidtaxdiff = (this.getBuyTax() - this.getBidTax());
                let emabiddiff = (price.marketSell * (1 - bidtaxdiff) / currEMA * 100) - 100;
                // stopped = this.takeProfit(this.takeProfitRatio);
                // if (stopped) return;

                // check if the trade started on this asset, otherwise hold
                let scalpProfit = this.adaptativeScalp();

                //if (asset === "XBT" || asset === "ETH") {
                // for "stable" assets like BTC and ETH, set a stoploss
                // if stoploss is broken, it may be a market crash
                // let stopLossRatio = this.getStopLossRatio(scalpProfit);

                // 1:1 risk to reward ratio
                if (price.lastTraded < this.getStopLoss()) {
                    this.log('SELL when Price hit stoploss');
                    return this.sell();
                }

                this.timeInTrade++;
                let winningTrade = price.marketSell > this.getSellWinningPrice();
                let winningScalpTrade = price.marketSell > this.getSellWinningPrice() * (1 + scalpProfit);
                let winningBidScalpTrade = price.marketSell > this.getAskWinningPrice() * (1 + scalpProfit);;

                if (winningScalpTrade) {
                    this.log('SELL Procedure on winning scalp');
                    return await this.sellProcedure(asset, candles, price.marketSell);
                    //return this.ask(price.lastTraded);
                } else if (winningBidScalpTrade) {
                    this.log('ASK on winning scalp');
                    return this.ask(price.marketSell);
                }

                // if EMA tells us to sell, sell if it's winning
                let emaBigUp = emadiff > this.adaptativeEMAUpTrigger(candles);
                if (emaBigUp && winningTrade) {
                    this.log('SELL on winning trade (after a big up)');
                    return this.sell();
                    //return this.ask(price.lastTraded);
                }

                let winningAsk = emabiddiff > this.adaptativeEMAUpTrigger(candles);
                if (winningAsk) {
                    this.log('ASK on winning trade (after a big up)');
                    return this.ask(price.marketSell);
                }

                let inSellZone = price.marketSell > lowest + amplitude * (1 - this.zoneTreshold);
                if (winningTrade && inSellZone) {
                    this.log('SELL Procedure when price in sell zone');
                    return await this.sellProcedure(asset, candles, price.marketSell);
                } else if (winningAsk && inSellZone) {
                    this.log('ASK when price in sell zone');
                    return this.ask(price.marketSell);
                }

                // if both tells us to sell (and it's not winning), sell if we didnt buy less than this.winTradePeriod min ago
                if (emaBigUp) {
                    // if we're shortly after buy, don't sell at loss
                    let winTradePeriod = this.getAdaptativeWinTradePeriod();
                    if (!winningTrade && this.timeInTrade <= winTradePeriod) {
                        return this.hold();
                    } else {
                        this.log('Loosing sell after EMA big up');
                        return this.ask(price.marketSell);
                        //return this.sell();
                    }
                }

                return this.hold();
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = ChampionTrader;