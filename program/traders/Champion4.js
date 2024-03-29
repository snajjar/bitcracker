const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');
const dt = require('../lib/datatools');

class ChampionTrader extends Trader {
    constructor() {
        super();

        // EMA triggers we react to
        this.emaPeriods = 2;
        this.emaDownTrigger = { 'min': 0.23, 'max': 0.4 };
        this.emaUpTrigger = { 'min': 0.15, 'max': 0.33 };

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
    }

    getScalpProfit() {
        return this.longWindowScalpProfit;
    }

    analysisIntervalLength() {
        return 700;
    }

    hash() {
        return "Algo_Champion4";
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
        let ADXTrendSeemsStrong = !isNaN(lastADX) && lastADX > 25;

        let [macd, signal, histo] = await this.getMACD(candles);
        let lastMACD = _.last(macd);
        let lastSignal = _.last(signal);
        let MACDTrendSeemsStrong = Math.abs(lastMACD - lastSignal) > 1.3;

        return ADXTrendSeemsStrong && MACDTrendSeemsStrong;
    }

    updateTrailingStopLoss(price) {
        let trailingStopLoss = _.get(this.currentTrade, ["trailingStopLoss"]);
        if (!trailingStopLoss || price > trailingStopLoss) {
            if (this.verbose) {
                console.log('Update trailing stoploss on winning scalp');
            }
            _.set(this.currentTrade, ["trailingStopLoss"], price);
        }
    }

    // return true if we hit the trailing stoploss
    belowTrailingStopLoss(price) {
        let trailingStopLossTolerance = 0.5;
        let trailingStopLoss = _.get(this.currentTrade, ["trailingStopLoss"]);
        let tolerance = trailingStopLossTolerance * this.adaptativeScalp();
        return price < trailingStopLoss * (1 - tolerance);
    }

    async sellProcedure(asset, candles, currentPrice) {
        // use ADX indicator to determine if the current upward trend is strong
        // if yes, hold our position a little bit longer
        // if no, sell now
        let strongTrend = await this.isTrendStrong(candles);
        if (strongTrend) {
            // console.log(`should sell at ${currentPrice} but hold`);
            this.updateTrailingStopLoss(currentPrice);
            return this.hold();
        } else {
            console.log(`SELLING as trend doesn't look strong`);
            return this.sell();
        }
    }

    getObjective() {
        return this.getSellWinningPrice() * (1 + this.adaptativeScalp());
    }

    // decide for an action
    async action(crypto, candles, currentPrice) {
        // calculate sma indicator
        try {
            let ema = await this.getEMA(candles);
            let currEMA = _.last(ema);
            let emadiff = (currentPrice / currEMA * 100) - 100;
            let bidtaxdiff = (this.getBuyTax() - this.getBidTax());
            let emabiddiff = (currentPrice * (1 - bidtaxdiff) / currEMA * 100) - 100;

            let highest = this.getHighest(candles);
            let lowest = this.getLowest(candles);
            let amplitude = highest - lowest;

            if (!this.isInTrade()) {
                let priceTreshold = lowest + amplitude * this.volatilityRange;
                if (currentPrice > priceTreshold) {
                    // console.log('close to all time high, hold');
                    return this.hold();
                }

                if (emadiff < -this.adaptativeEMADownTrigger(candles)) {
                    // BUY condition
                    this.timeInTrade = 0;
                    if (this.verbose) {
                        console.log('BUY after price drop');
                    }
                    return this.buy();
                    //return this.bid(currentPrice);
                } else if (emabiddiff < -this.adaptativeEMADownTrigger(candles)) {
                    if (this.verbose) {
                        console.log('BID after small price drop');
                    }
                    return this.bid(currentPrice);
                } else {
                    let assetVolatility = this.getAssetVolatility(candles);
                    // console.log(`${asset} volatility: ${assetVolatility}`);
                    let inBuyZone = assetVolatility > this.minZoneVolatility && currentPrice < lowest + amplitude * this.zoneTreshold;
                    if (inBuyZone) {
                        if (this.verbose) {
                            console.log('BID when price range in buy zone');
                        }
                        return this.bid(currentPrice);
                    } else {
                        return this.hold();
                    }
                    // return this.hold();
                }
            } else {
                // stopped = this.takeProfit(this.takeProfitRatio);
                // if (stopped) return;

                // check if the trade started on this crypto, otherwise hold
                let scalpProfit = this.adaptativeScalp();

                //if (crypto === "XBT" || crypto === "ETH") {
                // for "stable" assets like BTC and ETH, set a stoploss
                // if stoploss is broken, it may be a market crash
                // let stopLossRatio = this.getStopLossRatio(scalpProfit);

                // 1:1 risk to reward ratio
                let stopLossRatio = (this.getObjective() / this.currentTrade.enterPrice) - 1;
                let stopped = this.stopLoss(stopLossRatio);
                if (stopped) {
                    if (this.verbose) {
                        console.log('SELL when Price hit stoploss');
                    }
                    return this.sell();
                }

                if (this.belowTrailingStopLoss(currentPrice)) {
                    if (this.verbose) {
                        console.log('SELL when Price hit trailing stoploss');
                    }
                    return this.sell();
                }

                this.timeInTrade++;
                let winningTrade = currentPrice > this.getSellWinningPrice();

                let winningScalpTrade = currentPrice > this.getSellWinningPrice() * (1 + scalpProfit);
                let winningBidScalpTrade = currentPrice > this.getAskWinningPrice() * (1 + scalpProfit);;

                if (winningScalpTrade) {
                    if (this.verbose) {
                        console.log('SELL Procedure on winning scalp');
                    }
                    return await this.sellProcedure(crypto, candles, currentPrice);
                    //return this.ask(currentPrice);
                } else if (winningBidScalpTrade) {
                    if (this.verbose) {
                        console.log('ASK on winning scalp');
                    }
                    return this.ask(currentPrice);
                }

                // if EMA tells us to sell, sell if it's winning
                let emaBigUp = emadiff > this.adaptativeEMAUpTrigger(candles);
                if (emaBigUp && winningTrade) {
                    if (this.verbose) {
                        console.log('SELL on winning trade (after a big up)');
                    }
                    return this.sell();
                    //return this.ask(currentPrice);
                }

                let winningAsk = emabiddiff > this.adaptativeEMAUpTrigger(candles);
                if (winningAsk) {
                    if (this.verbose) {
                        console.log('ASK on winning trade (after a big up)');
                    }
                    return this.ask(currentPrice);
                }

                let inSellZone = currentPrice > lowest + amplitude * (1 - this.zoneTreshold);
                if (winningTrade && inSellZone) {
                    if (this.verbose) {
                        console.log('SELL Procedure when price in sell zone');
                    }
                    return await this.sellProcedure(crypto, candles, currentPrice);
                } else if (winningAsk && inSellZone) {
                    if (this.verbose) {
                        console.log('ASK when price in sell zone');
                    }
                    return this.ask(currentPrice);
                }

                // if both tells us to sell (and it's not winning), sell if we didnt buy less than this.winTradePeriod min ago
                if (emaBigUp) {
                    // if we're shortly after buy, don't sell at loss
                    let winTradePeriod = this.getAdaptativeWinTradePeriod();
                    if (!winningTrade && this.timeInTrade <= winTradePeriod) {
                        return this.hold();
                    } else {
                        if (this.verbose) {
                            console.log('Loosing sell after EMA big up');
                        }
                        return this.ask(currentPrice);
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