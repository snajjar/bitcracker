const _ = require('lodash');
const moment = require('moment');

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
            volume: candle.volume,
            trend: candle.trend || "still",
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

const breakData = function(data, breakTimestamp) {
    let breakIndex = 0;
    for (var i = 0; i < data.length; i++) {
        if (data[i].timestamp < breakTimestamp) {
            breakIndex = i;
        } else {
            break;
        }
    }

    if (breakIndex + 1 < data.length) {
        breakIndex++;
    }
    return [data.slice(0, breakIndex), data.slice(breakIndex)];
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

const rangeStr = function(btcData) {
    let startStr = moment.unix(btcData[0].timestamp).format('DD/MM/YYYY hh:mm');
    let endStr = moment.unix(btcData[btcData.length - 1].timestamp).format('DD/MM/YYYY hh:mm');
    return `${startStr} -> ${endStr} (${btcData.length} periods)`;
}

// function that will add labels at start of significative trends
// we define trend as such: a successive set of periods in which the close price reach
// the target price (price + price * target) before reaching price again
const labelTrends = function(candles, targetUp = 0.05, targetDown = 0.05) {
    let currentTrend = "still";
    let trendStartIndex = 0;

    // label candles after the trend start, but that still have a targetUp augmentation
    //  or targetDown diminution at the end of the trend
    let labelIntermediateCandles = function(startIndex, endIndex, trend, topTrendValue) {
        for (let i = startIndex; i <= endIndex; i++) {
            let candle = candles[i];

            if (trend == "up") {
                if (candle.close * (1 + targetUp) < topTrendValue) {
                    candle.trend = "up";
                }
            } else if (trend == "down") {
                if (candle.close * (1 - targetDown) > topTrendValue) {
                    candle.trend = "down";
                }
            }
        }
    }

    for (var i = 1; i < candles.length; i++) {
        let candle = candles[i];

        if (candle.close > candle.open) {
            switch (currentTrend) {
                case "up":
                    // nothing to do for now
                    break;
                case "still":
                    // start of a trend
                    trendStartIndex = i - 1;
                    currentTrend = "up";
                    break;
                case "down":
                    // label the previous trend if significative
                    let trendStartCandle = candles[trendStartIndex];
                    let trendTarget = trendStartCandle.close * (1 - targetDown)
                    if (candle.open <= trendTarget) {
                        trendStartCandle.trend = "down";
                        labelIntermediateCandles(trendStartIndex, i, "down", candle.open);
                    }


                    // start of a trend
                    trendStartIndex = i - 1;
                    currentTrend = "up";
                    break;
                default:
                    throw new Error("unrecognized current trend: " + currentTrend);
            }
        } else if (candle.close < candle.open) {
            switch (currentTrend) {
                case "up":
                    // label the previous trend if significative
                    let trendStartCandle = candles[trendStartIndex];
                    let trendTarget = trendStartCandle.close * (1 + targetUp);
                    if (candle.open >= trendTarget) {
                        trendStartCandle.trend = "up";
                        labelIntermediateCandles(trendStartIndex, i, "up", candle.open);
                    }

                    // start of a trend
                    trendStartIndex = i - 1;
                    currentTrend = "down";
                    break;
                case "still":
                    // start of a trend
                    trendStartIndex = i - 1;
                    currentTrend = "down";
                    break;
                case "down":
                    // nothing to do for now
                    break;
                default:
                    throw new Error("unrecognized current trend: " + currentTrend);
            }
        }
    }

    // label data with no trend labelled
    _.each(candles, candle => {
        if (!candle.trend) {
            candle.trend = "still";
        }
    });

    return candles;
}

// const data = [
//     { "open": 100, "close": 99 },
//     { "open": 99, "close": 101 },
//     { "open": 101, "close": 102 },
//     { "open": 102, "close": 101 },
//     { "open": 101, "close": 106 },
//     { "open": 106, "close": 108 },
//     { "open": 108, "close": 107 },
//     { "open": 107, "close": 104 },
//     { "open": 104, "close": 105 },
//     { "open": 105, "close": 108 },
//     { "open": 108, "close": 113 },
//     { "open": 113, "close": 114 },
//     { "open": 114, "close": 110 },
//     { "open": 110, "close": 108 },
//     { "open": 108, "close": 110 },
//     { "open": 110, "close": 107 },
//     { "open": 107, "close": 105 },
//     { "open": 105, "close": 106 },
//     { "open": 106, "close": 110 },
//     { "open": 110, "close": 113 },
//     { "open": 113, "close": 117 },
//     { "open": 117, "close": 121 },
//     { "open": 121, "close": 119 },
//     { "open": 119, "close": 117 },
//     { "open": 117, "close": 115 },
//     { "open": 115, "close": 111 },
//     { "open": 111, "close": 112 },
// ]

// labelTrends(data);
// console.log(data);

module.exports = {
    dataVariations,
    mergeSamples,
    getMax,
    splitData,
    kSplitData,
    cutDataBefore,
    cutDataAfter,
    equalize,
    breakData,
    rangeStr,
    labelTrends
}