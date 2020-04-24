const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class CaptainPlanetTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 2;
        this.adxPeriods = 14;
        this.smaPeriods = 250;
        this.rsiPeriods = 70;
        this.emaUpTrigger = 0.4;
        this.emaDownTrigger = 0.4;
        this.adxTrigger = 13;
        this.smaTrigger = 0.025;

        this.enteredTrade = null;
    }

    analysisIntervalLength() {
        //return Math.max(this.emaPeriods, this.adxPeriods) + 1;
        return Math.max(this.emaPeriods, this.adxPeriods, this.smaPeriods, this.rsiPeriods) + 1;
    }

    hash() {
        return "Algo_CaptainPlanet";
    }

    getEMA(dataPeriods) {
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

    getRSI(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.rsi.indicator([closePrices], [this.rsiPeriods], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // calculate sma indicator
        try {
            // determine start trend with EMA
            let ema = await this.getEMA(dataPeriods);
            let currEMA = ema[ema.length - 1];
            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let emaTrendUp = diff < -this.emaUpTrigger;
            let emaTrendDown = diff > this.emaDownTrigger;

            // also determine start trend with SMA
            let sma = await this.getSMA(dataPeriods);
            let currSMA = sma[sma.length - 1];
            let delta = (currSMA - currentBitcoinPrice) / currSMA;
            let smaTrendUp = delta > this.smaTrigger;
            let smaTrendDown = -delta > this.smaTrigger;

            // determine trend strengh with ADX
            let adx = await this.getADX(dataPeriods);
            let lastADX = adx[adx.length - 1];
            // let trendSeemsStrong = !isNaN(lastADX) && lastADX > this.adxTrigger;

            // determine momentum oscillation with RSI
            let rsi = await this.getRSI(dataPeriods);
            let lastRSI = rsi[rsi.length - 1];
            let overbought = lastRSI > 95;
            let oversold = lastRSI < 5;

            if (!this.inTrade) {
                if (emaTrendUp || oversold) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (emaTrendDown || overbought) {
                    // SELL conditions are take profit and stop loss
                    return this.sell();
                } else {
                    return this.hold();
                }
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = CaptainPlanetTrader;