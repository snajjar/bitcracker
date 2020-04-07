/******************************************************************************
 * indicator.js - fill trade data with widely used indicators
 *****************************************************************************/
const Ichimoku = require('ichimoku');
const _ = require('lodash');

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

/*
var test = async function test() {
    const csv = require('./csv');
    let btcData = await csv.getData(`./data/Cex_BTCEUR_5m_Refined.csv`);
    //console.log(btcData);

    // test on 5min period, 4h local min/max
    let period = 48;
    btcData = btcData.slice(0, 2016 + period);

    addLocalMinMaxIndicator(btcData, period);
    for (let candle of btcData) {
        indicator = candle.min ? '[MIN]' : (candle.max ? '[MAX]' : '');
        console.log(`low ${candle.low.toFixed(2)}€ -> high ${candle.high.toFixed(2)}€ ${indicator}`);
    }
}

test();
*/

module.exports = {
    addIchimokuIndicator,
    addLocalMinMaxIndicator
}