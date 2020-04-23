const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class ChampionTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.smaPeriods = 200;
        this.emaPeriods = 2;
        this.adxPeriods = 14;

        this.smaTrigger = 0.000;
        this.winningTreshold = 0.5;
        this.emaUpTrigger = 0.3;
        this.emaDownTrigger = 0.4;
        this.adxTrigger = 15;
        this.bbandTrigger = 0.014;
    }

    analysisIntervalLength() {
        return Math.max(this.emaPeriods, this.adxPeriods, this.smaPeriods) + 1;
    }

    hash() {
        return "Algo_Champion";
    }

    getSMA(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.sma.indicator([closePrices], [this.smaPeriods], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    getEMA(dataPeriods) {
        // filter out last periods
        dataPeriods = dataPeriods.slice(dataPeriods.length - 28);

        let closePrices = _.map(dataPeriods, p => p.close);
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

    getADX(dataPeriods) {
        dataPeriods = dataPeriods.slice(dataPeriods.length - 28);

        let highPrices = _.map(dataPeriods, p => p.high);
        let lowPrices = _.map(dataPeriods, p => p.low);
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.adx.indicator([highPrices, lowPrices, closePrices], [this.adxPeriods], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    getBBands(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.bbands.indicator([closePrices], [20, 2], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve([results[0], results[1], results[2]]);
                }
            });
        });
    }

    // the more we are winning a trade, the more we'll be encline to
    // sell if the trend looks like it's going down
    decideSell(currentEMA, currentBitcoinPrice) {
        let diff = (currentBitcoinPrice / currentEMA * 100) - 100;
        let floattingPoint = this.enterTradeValue * (1 + this.buyTax + this.sellTax);
        let winningTrade = currentBitcoinPrice > floattingPoint;

        if (winningTrade) {
            // check by how much we are winning
            let ratio = (currentBitcoinPrice - floattingPoint) / this.enterTradeValue;

            // usually, we compare diff to emaDownTrigger, which can be choosen from 0.2 (loose trend) to 0.4 (strong trend)
            // the more the ratio is up, the more we want to sell on loose down trend
            let treshold = this.emaDownTrigger / Math.pow(1 + ratio, 3);
            // console.log('treshold: ' + treshold, 'ratio: ' + ratio);
            return diff > treshold;
        } else {
            // sell if it's looking nasty
            return diff > this.emaDownTrigger;
        }
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            // determine trend with EMA
            let ema = await this.getEMA(dataPeriods);
            let currEMA = ema[ema.length - 1];
            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let trendUp = diff < -this.emaUpTrigger;
            let trendDown = diff > this.emaDownTrigger;
            let smallTrendDown = diff > this.emaDownTrigger / 2;

            // // determine trend strengh with ADX
            let adx = await this.getADX(dataPeriods);
            let lastADX = adx[adx.length - 1];
            let trendSeemsStrong = !isNaN(lastADX) && lastADX > this.adxTrigger;

            if (!this.inTrade) {
                if (trendUp && trendSeemsStrong) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (this.decideSell(currEMA, currentBitcoinPrice)) {
                    // SELL condition
                    return this.sell();
                } else {
                    return this.hold();
                }
                this.hold();
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = ChampionTrader;