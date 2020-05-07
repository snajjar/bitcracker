const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMAProfitTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 5;
        this.emaUpTrigger = 0.333;
        this.emaDownTrigger = 0.2;
        this.maxTimeInTrade = 1440 * 0.5; // 1 day
        this.objective = 0.03;
        // this.adxPeriods = 14;
        // this.adxMinTrigger = 7;
        // this.adxMaxTrigger = 90;
        this.bbandTrigger = 0.004;
        this.volatilityTrigger = 0.0042;

        // trade decision making
        this.inTrade = false;
        this.enterTradeValue = 0;
        this.timeInTrade = 0;
        this.step = (this.objective - this.getBuyTax() + this.getSellTax()) / this.maxTimeInTrade;
    }

    analysisIntervalLength() {
        //return this.emaPeriods + 1;
        return 50;
    }

    hash() {
        return "Algo_EMAProfit";
    }

    getAVG(dataPeriods) {
        return _.meanBy(dataPeriods, 'close')
    }


    getEMA(dataPeriods) {
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

    getRSI(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.rsi.indicator([closePrices], [14], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    }

    getBBands(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.bbands.indicator([closePrices], [40, 2], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve([results[0], results[1], results[2]]);
                }
            });
        });
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(0.1);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        let ema = await this.getEMA(dataPeriods);
        let currEMA = ema[ema.length - 1];

        var diff = (currentBitcoinPrice / currEMA * 100) - 100;
        let bigDown = diff < -this.emaDownTrigger;
        let bigUp = diff > this.emaUpTrigger;

        if (!this.inTrade) {
            // let adx = await this.getADX(dataPeriods);
            // let lastADX = adx[adx.length - 1];

            // // if adx is broken, don't filter
            // let trendSeemsGood = isNaN(lastADX) || (this.adxMinTrigger <= lastADX && lastADX <= this.adxMaxTrigger);

            // validate that momentum seems right, we are not buying when going into oversold
            let rsi = await this.getRSI(dataPeriods);
            let lastRSI = rsi[0][rsi[0].length - 1];
            let overbought = lastRSI > 68;

            // get Bollinger bands, estimate the volatility
            let [lowBand, midBand, highBand] = await this.getBBands(dataPeriods);
            let vol = [];
            for (var i = 0; i < lowBand.length; i++) {
                let volatility = ((highBand[i] - midBand[i]) + (midBand[i] - lowBand[i])) / midBand[i];
                vol.push(volatility);
            }
            let avgVolatility = _.mean(vol);
            let priceIsVolatile = avgVolatility > this.volatilityTrigger;


            if (bigDown && !overbought && priceIsVolatile) {
                // BUY condition
                this.timeInTrade = 0;
                return this.buy();
            } else {
                return this.hold();
            }
        } else {
            this.timeInTrade++;
            let objectivePrice = this.enterTradeValue * (1 + this.objective - this.timeInTrade * this.step);
            if (currentBitcoinPrice > objectivePrice || bigUp) {
                this.sell();
            } else {
                return this.hold();
            }
        }
    }
}

module.exports = EMAProfitTrader;