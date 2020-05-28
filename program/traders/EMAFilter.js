const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMAFilterTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 3;
        this.emaTrigger = 0.3;

        this.smaPeriods = 200;
        this.adxPeriods = 14;
        this.rsiPeriods = 70;
        this.obvPeriods = 24;
    }

    analysisIntervalLength() {
        return 200;
    }

    hash() {
        return "Algo_EMAFilter";
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

    getOBV(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        let volumes = _.map(dataPeriods, p => p.volume);
        return new Promise((resolve, reject) => {
            tulind.indicators.obv.indicator([closePrices, volumes], [], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    // return true if the price is growing on the last periods
    isGrowingPrice(dataPeriods, n) {
        let periods = dataPeriods.slice(dataPeriods.length - n);
        let growing = true;
        for (var i = 1; i < n; i++) {
            if (periods[i - 1].close >= periods[i].close) {
                growing = false;
                break;
            }
        }
        return growing;
    }

    // return true if the price is growing on the last periods
    isGrowingVolumes(dataPeriods, n) {
        let obv = this.getOBV(dataPeriods);
        let growing = true;
        for (var i = 1; i < n; i++) {
            if (obv[i - 1] * 1.5 >= obv[i]) {
                growing = false;
                break;
            }
        }
        return growing;
    }

    // return true if the price is growing on the last periods
    isShrinkingPrice(dataPeriods, n) {
        let periods = dataPeriods.slice(dataPeriods.length - n);
        let shrinking = true;
        for (var i = 1; i < n; i++) {
            if (periods[i - 1].close <= periods[i].close) {
                shrinking = false;
                break;
            }
        }
        return shrinking;
    }

    isGrowingEMA(dataPeriods, n) {
        let ema = this.getEMA(dataPeriods);
        let growing = true;
        for (var i = 1; i < n; i++) {
            if (ema[i - 1] >= ema[i]) {
                growing = false;
                break;
            }
        }
        return growing;
    }

    // decide for an action
    async action(crypto, dataPeriods, currentBitcoinPrice) {
        let stopped = this.stopLoss(0.02);
        if (stopped) return;

        stopped = this.takeProfit(0.01);
        if (stopped) return;

        // calculate sma indicator
        try {
            let ema = await this.getEMA(dataPeriods);
            let currEMA = ema[ema.length - 1];

            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let trendUp = diff < -this.emaTrigger;
            let trendDown = diff > this.emaTrigger;

            // calculate SMA (use SMA as support)
            // let sma = await this.getSMA(dataPeriods);
            // let currSMA = sma[sma.length - 1];
            // let buyFilter = currentBitcoinPrice > currSMA;

            // calculate RSI
            // let rsi = await this.getRSI(dataPeriods);
            // let lastRSI = rsi[rsi.length - 1];
            // //let overbought = lastRSI > 50;
            // let oversold = lastRSI < 20;
            //let buyFilter = lastRSI < 25;

            // let growingPrice = this.isGrowingPrice(dataPeriods, 2);
            // let growingVolumes = this.isGrowingVolumes(dataPeriods, 2);
            // let growingEMA = this.isGrowingEMA(dataPeriods, 2);

            if (!this.isInTrade()) {
                if (trendUp) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (trendDown) {
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

module.exports = EMAFilterTrader;