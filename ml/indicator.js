/******************************************************************************
 * indicator.js - fill trade data with widely used indicators
 *****************************************************************************/
const Ichimoku = require('ichimoku');
const _ = require('lodash');


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

module.exports = {
    addIchimokuIndicator
}