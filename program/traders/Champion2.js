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
        this.shortScalpProfit = { 'min': 0.0015, 'max': 0.0064 };

        // how close we are to the highest value of the analysis interval
        this.volatilityRange = 0.5;
        this.volatilityFactor = 3.9; // to power of 4

        // if we get to the lowest 4% of the price amplitude of history, let's take action
        this.zoneTreshold = 0.04;
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
        let volatility = 1 + (highest - lowest) / highest;
        return volatility;
    }

    // expected more than 87.5% return, set stoploss at 8x gain (counting taxes too)
    getStopLossRatio(targetProfit) {
        return targetProfit * 8 - this.getBidTax() * 2;
    }

    // decide for an action
    async action(crypto, candles, price) {
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
                    return this.buy();
                    //return this.bid(price.lastTraded);
                } else if (emabiddiff < -this.adaptativeEMADownTrigger(candles)) {
                    return this.bid(price.marketBuy);
                } else {
                    let assetVolatility = this.getAssetVolatility(candles);
                    // console.log(`${asset} volatility: ${assetVolatility}`);
                    let inBuyZone = assetVolatility > 1.02 && price.lastTraded < lowest + amplitude * this.zoneTreshold;
                    if (inBuyZone) {
                        return this.bid(price.marketBuy);
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

                // check if the trade started on this crypto, otherwise hold
                if (this.getCurrentTradeAsset() == crypto) {
                    let scalpProfit = this.adaptativeScalp();

                    //if (crypto === "XBT" || crypto === "ETH") {
                    // for "stable" assets like BTC and ETH, set a stoploss
                    // if stoploss is broken, it may be a market crash
                    let stopLossRatio = this.getStopLossRatio(scalpProfit);
                    let stopped = this.stopLoss(stopLossRatio);
                    if (stopped) return this.sell();
                    //}

                    this.timeInTrade++;
                    let winningTrade = price.marketSell > this.getSellWinningPrice();
                    let winningScalpTrade = price.marketSell > this.getSellWinningPrice() * (1 + scalpProfit);
                    let winningBidScalpTrade = price.marketSell > this.getAskWinningPrice() * (1 + scalpProfit);;

                    if (winningScalpTrade) {
                        return this.sell();
                        //return this.ask(price.lastTraded);
                    }

                    if (winningBidScalpTrade) {
                        return this.ask(price.marketSell);
                    }

                    // if EMA tells us to sell, sell if it's winning
                    let emaBigUp = emadiff > this.adaptativeEMAUpTrigger(candles);
                    if (emaBigUp && winningTrade) {
                        return this.sell();
                        //return this.ask(price.lastTraded);
                    }

                    let winningAsk = emabiddiff > this.adaptativeEMAUpTrigger(candles);
                    if (winningAsk) {
                        return this.ask(price.marketSell);
                    }

                    let inSellZone = price.marketSell > lowest + amplitude * (1 - this.zoneTreshold);
                    if (winningTrade && inSellZone) {
                        return this.sell();
                    } else if (winningAsk && inSellZone) {
                        return this.ask(price.marketSell);
                    }

                    // if both tells us to sell (and it's not winning), sell if we didnt buy less than this.winTradePeriod min ago
                    if (emaBigUp) {
                        // if we're shortly after buy, don't sell at loss
                        let winTradePeriod = this.getAdaptativeWinTradePeriod();
                        if (!winningTrade && this.timeInTrade <= winTradePeriod) {
                            return this.hold();
                        } else {
                            return this.ask(price.marketSell);
                            //return this.sell();
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