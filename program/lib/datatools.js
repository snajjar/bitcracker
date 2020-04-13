const _ = require('lodash');

// cap variation between 0.5 and 1.5 to avoid absurd data effects
const capVariation = function(variation, maxVariance) {
    if (variation > 1 + maxVariance) {
        return 1 + maxVariance;
    } else if (variation < 1 - maxVariance) {
        return 1 - maxVariance;
    } else {
        return variation;
    }
}

// data: array of arrays
const dataVariations = function(data, maxVariance = 0.1) {
    let maxHighVariation = 1;
    let minLowVariation = 1;
    let variations = [];

    let highVariations = [];
    let lowVariations = [];

    // console.log('[*] transforming price data into relative variations');

    for (let i = 0; i < data.length; i++) {
        let candle = data[i];

        // console.log(candle);

        let openVariation = 1; // should be 1
        let closeVariation = capVariation(candle.close / candle.open, maxVariance);
        let lowVariation = capVariation(candle.low / candle.open, maxVariance);
        let highVariation = capVariation(candle.high / candle.open, maxVariance);

        highVariations.push(highVariation);
        lowVariations.push(lowVariation);

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

    highVariations = _.sortBy(highVariations);
    lowVariations = _.sortBy(lowVariations);
    // console.log(`  - avg high var: ${_.mean(highVariations)}`);
    // console.log(`  - avg low var: ${_.mean(lowVariations)}`);
    // console.log(`  - 99% percentile high var: ${highVariations[Math.floor(lowVariations.length * 99/100)]}`);
    // console.log(`  - 99% percentile low var: ${lowVariations[Math.floor(lowVariations.length * 1/100)]}`);


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

const cutDataBefore = function(startTimestamp, data) {
    let startIndex = 0;
    for (var i = 0; i < data.length; i++) {
        if (data[i].timestamp < startTimestamp) {
            startIndex = i;
        } else {
            break;
        }
    }

    if (data.length > startIndex + 1) {
        return data.slice(startIndex + 1);
    } else {
        return [];
    }
}

const cutDataAfter = function(endTimestamp, data) {
    let endIndex = 0;
    for (var i = 0; i < data.length; i++) {
        if (data[i].timestamp < endTimestamp) {
            endIndex = i;
        } else {
            break;
        }
    }

    if (endIndex + 1 < data.length) {
        endIndex++;
    }
    return data.slice(0, endIndex);
}

// make sure the price starting point is where the endpoint is
const equalize = function(data) {
    let endValue = data[data.length - 1].close;

    let startIndex = 0;
    for (var i = 0; i < data.length; i++) {
        if (data[i].low < endValue && endValue < data[i].high) {
            startIndex = i;
            break;
        }
    }

    return data.slice(startIndex);
}

module.exports = {
    dataVariations,
    mergeSamples,
    getMax,
    splitData,
    kSplitData,
    cutDataBefore,
    cutDataAfter,
    equalize,
}