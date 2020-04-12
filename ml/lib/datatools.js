const _ = require('lodash');

// data: array of arrays
const dataVariations = function(data) {
    let maxHighVariation = 1;
    let minLowVariation = 1;
    let variations = [];

    console.log('[*] transforming price data into relative variations');

    for (let i = 0; i < data.length; i++) {
        let candle = data[i];

        // console.log(candle);

        let openVariation = 1; // should be 1
        let closeVariation = candle.close / candle.open;
        let lowVariation = candle.low / candle.open;
        let highVariation = candle.high / candle.open;

        //console.log('lowVariation: ' + lowVariation);
        console.log(`open: ${candle.open}, high: ${candle.high}, low: ${candle.low}, close: ${candle.close} lowVariation: ${lowVariation}`);

        if (maxHighVariation < highVariation) {
            maxHighVariation = highVariation;
        }
        if (minLowVariation > lowVariation) {
            minLowVariation = lowVariation;
        }

        let candleVariations = {
            timestamp: candle.timestamp,
            open: openVariation,
            close: closeVariation,
            high: highVariation,
            low: lowVariation,
            volume: candle.volume
        }
        // console.log(candleVariations);
        variations.push(candleVariations);
    }

    console.log(`  - highest up variation: ${maxHighVariation}`);
    console.log(`  - highest down variation: ${minLowVariation}`);

    return variations;
}

const mergeSamples = function(intervalStart, arr) {
    if (!arr || !arr.length) {
        throw "mergeSamples: empty array";
    }

    let high = -Infinity;
    let low = +Infinity;
    let volume = 0;

    _.each(arr, (period) => {
        let pHigh = Math.max(period.high, period.open, period.close);
        let pLow = Math.min(period.low, period.open, period.close);

        if (pHigh > high) {
            high = pHigh;
        }
        if (pLow < low) {
            low = pLow;
        }
        volume += period.volume;
    });

    return {
        "timestamp": intervalStart.unix(),
        "open": arr[0].open,
        "high": high,
        "low": low,
        "close": arr[arr.length - 1].close,
        "volume": volume
    }
}

const getMax = function(data) {
    let max = -Infinity;
    for (let i = 1; i < data.length; i++) {
        for (let j = 0; j < data[i].length; j++) {
            if (max < data[i][j]) {
                max = data[i][j];
            }
        }
    }

    return max;
}


const splitData = function(data, ratio = 0.75) {
    // split our data into train data and test data
    let l = data.length;
    let limit = Math.round(data.length * ratio);
    const trainData = data.slice(0, limit); // use 80% of our data to train
    const testData = data.slice(limit);

    console.log('[*] splitting data:');
    console.log(`[*]   train sample: size ${trainData.length}`);
    console.log(`[*]   test sample: size ${testData.length}`);

    return [trainData, testData];
}

const kSplitData = function(data, ratio = 0.2) {
    if (ratio >= 0.5) {
        throw "ratio too high for kSplitData";
    }

    let rest = data;
    let sample = null;
    let samples = [];
    let limit = Math.round(data.length * ratio);
    let nbSplit = Math.round(1 / ratio);

    console.log(`[*] splitting data into samples of size ${limit}`);

    for (var i = 0; i < nbSplit; i += 1) {
        samples.push(rest.slice(0, limit));
        rest = rest.slice(limit);
    }

    return samples;
}

module.exports = {
    dataVariations,
    mergeSamples,
    getMax,
    splitData,
    kSplitData,
}