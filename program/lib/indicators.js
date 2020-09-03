/******************************************************************************
 * indicator.js - fill trade data with widely used indicators
 *****************************************************************************/
const Ichimoku = require('ichimoku');
const _ = require('lodash');
const tulind = require('tulind');
const dt = require('./datatools');

// Add a min and max indicator on the data
// if the current candle has the max high value for the [-nbPeriod/2, +nbPeriod/2] interval, add the candle.max = true indicator
// if the current candle has the min low value for the  [-nbPeriod/2, +nbPeriod/2] interval, add the candle.min = true indicator
var addLocalMinMaxIndicator = function(data, nbPeriod) {
    var getCandlesForPeriod = function(n) {
        let candles = [];
        for (var i = n - nbPeriod / 2; i < n + nbPeriod / 2; i++) {
            candles.push(data[i]);
        }
        return candles;
    }

    var getMaxForPeriod = function(n) {
        let candles = getCandlesForPeriod(n);
        if (candles.length == nbPeriod) {
            let maxCandle = _.maxBy(getCandlesForPeriod(n), 'high');
            return maxCandle && maxCandle.high
        } else {
            return null;
        }
    }

    var getMinForPeriod = function(n) {
        let candles = getCandlesForPeriod(n);
        if (candles.length == nbPeriod) {
            let minCandle = _.minBy(getCandlesForPeriod(n), 'low');
            return minCandle && minCandle.low
        } else {
            return null;
        }
    }

    for (let i = 0; i < data.length; i++) {
        if (i > nbPeriod / 2 && i < data.length - nbPeriod / 2) {
            let candle = data[i];
            if (candle.high === getMaxForPeriod(i)) {
                candle.max = true;
            } else {

            }
            if (candle.low === getMinForPeriod(i)) {
                candle.min = true;
            }
        }
    }
}

var addIchimokuIndicator = function(data) {
    const ichimoku = new Ichimoku({
        conversionPeriod: 9,
        basePeriod: 26,
        spanPeriod: 52,
        displacement: 26,
        values: []
    })

    for (let candle of data) {
        let ichimokuValue = ichimoku.nextValue({
            high: candle.high,
            low: candle.low,
            close: candle.close
        });

        _.set(candle, ["indicators", "ichimoku"], {});

        _.each(ichimokuValue, (v, k) => {
            candle.indicators.ichimoku[v] = k;
        });
    }

    return ichimokuValues;
}

/**
 *   Finding support and resistance price areas
 */
const getSupportsAndResistances = function(candles) {
    let areas = []; // array of results areas, with estimated break probability

    // identify min and max turning points for candles highest and lowest values
    let turningPoints = [];
}

// average true range indicator
const getATR = function(candles) {
    candles = candles.slice(candles.length - (14 * 5));
    let merged = dt.mergeCandlesBy(candles, 5);
    let s = 0;
    for (let candle of merged) {
        s += (candle.high - candle.low) / candle.low;
    }
    return s / candles.length;
}

// return a percentage of how much the action moved compared to it's price
const getVolatility = function(candles) {
    let highest = this.getHighest(candles);
    let lowest = this.getLowest(candles);
    let volatility = 1 + (highest - lowest) / highest;
    return volatility;
}

const getEMA = function(candles, period) {
    let closePrices = _.map(candles, p => p.close);
    return new Promise((resolve, reject) => {
        tulind.indicators.ema.indicator([closePrices], [period], function(err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results[0]);
            }
        });
    });
}

const getSMA = function(candles, period) {
    let closePrices = _.map(candles, p => p.close);
    return new Promise((resolve, reject) => {
        tulind.indicators.ema.indicator([closePrices], [period], function(err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results[0]);
            }
        });
    });
}

const getMACD = function(candles) {
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

const getHighest = function(candles) {
    return _.maxBy(candles, o => o.high).high;
}

const getLowest = function(candles) {
    return _.minBy(candles, o => o.low).low;
}

const getRSI = function(candles) {
    let closePrices = _.map(candles, p => p.close);
    return new Promise((resolve, reject) => {
        tulind.indicators.rsi.indicator([closePrices], [14], function(err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results[0]);
            }
        });
    });
}

module.exports = {
    addIchimokuIndicator,
    addLocalMinMaxIndicator,
    getATR,
    getEMA,
    getSMA,
    getMACD,
    getVolatility,
    getHighest,
    getLowest,
    getRSI,
}