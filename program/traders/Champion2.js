const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');
const dt = require('../lib/datatools');

class ChampionTrader extends Trader {
    constructor() {
        super();

        // EMA triggers we react to
        this.emaPeriods = 2;
        this.emaDownTrigger = { 'min': 0.28, 'max': 0.36 };
        this.emaUpTrigger = { 'min': 0.18, 'max': 0.36 };

        // Trader will also scalp shortly after a buy
        this.timeInTrade = null;
        this.winTradePeriod = { 'min': 60, 'max': 120 };
        this.shortScalpProfit = { 'min': 0.002, 'max': 0.007 };

        // how close we are to the highest value of the analysis interval
        this.volatilityRange = 0.5;
    }

    analysisIntervalLength() {
        return 700;
    }

    hash() {
        return "Algo_Champion2";
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
        return this.logSlider(this.emaDownTrigger.min + assetVolatility, this.emaDownTrigger.max + assetVolatility, this.getTaxRatio());
    }

    adaptativeEMAUpTrigger(candles) {
        // adjust thoses triggers to the asset volatility
        let assetVolatility = this.getAssetVolatility(candles);
        return this.logSlider(this.emaUpTrigger.min + assetVolatility, this.emaUpTrigger.max + assetVolatility, this.getTaxRatio());
    }

    adaptativeScalp() {
        return this.logSlider(this.shortScalpProfit.min, this.shortScalpProfit.max, this.getTaxRatio());
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
        let volatility = (highest - lowest) / highest;
        return volatility;
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

            if (!this.isInTrade()) {
                let highest = this.getHighest(candles);
                let lowest = this.getLowest(candles);
                let volatility = highest - lowest;
                let priceTreshold = lowest + volatility * this.volatilityRange;
                if (currentPrice > priceTreshold) {
                    // console.log('close to all time high, hold');
                    return this.hold();
                } else {
                    //console.log(`price: ${currentPrice}, low: ${lowest}, high: ${highest}`);
                }

                if (emadiff < -this.adaptativeEMADownTrigger(candles)) {
                    // BUY condition
                    this.timeInTrade = 0;
                    //return this.buy();
                    return this.bid(currentPrice);
                } else if (emabiddiff < -this.adaptativeEMADownTrigger(candles)) {
                    return this.bid(currentPrice);
                } else {
                    return this.hold();
                }
            } else {
                // stopped = this.takeProfit(this.takeProfitRatio);
                // if (stopped) return;

                // check if the trade started on this crypto, otherwise hold
                if (this.getCurrentTradeAsset() == crypto) {
                    let stopped = this.stopLoss(0.2);
                    if (stopped) return this.sell();

                    this.timeInTrade++;
                    let winningTrade = currentPrice > this.getSellWinningPrice();

                    let scalpProfit = this.adaptativeScalp();
                    let winningScalpTrade = currentPrice > this.getSellWinningPrice() * (1 + scalpProfit);
                    let winningBidScalpTrade = currentPrice > this.getAskWinningPrice() * (1 + scalpProfit);;

                    if (winningScalpTrade) {
                        //return this.sell();
                        return this.ask(currentPrice);
                    }

                    if (winningBidScalpTrade) {
                        return this.ask(currentPrice);
                    }

                    // if EMA tells us to sell, sell if it's winning
                    let emaBigUp = emadiff > this.adaptativeEMAUpTrigger(candles);
                    if (emaBigUp && winningTrade) {
                        //return this.sell();
                        return this.ask(currentPrice);
                    }

                    let winningAsk = emabiddiff > this.adaptativeEMAUpTrigger(candles);
                    if (winningAsk) {
                        return this.ask(currentPrice);
                    }

                    // if both tells us to sell (and it's not winning), sell if we didnt buy less than this.winTradePeriod min ago
                    if (emaBigUp) {
                        // if we're shortly after buy, don't sell at loss
                        let winTradePeriod = this.getAdaptativeWinTradePeriod();
                        if (!winningTrade && this.timeInTrade <= winTradePeriod) {
                            return this.hold();
                        } else {
                            return this.ask(currentPrice);
                            //return this.hold();
                        }
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