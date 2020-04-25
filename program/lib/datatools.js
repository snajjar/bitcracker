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

const mergeCandles = function(arr, intervalStart) {
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
        "timestamp": intervalStart ? intervalStart.unix() : arr[0].timestamp,
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

const splitByDuration = function(candles, duration) {
    let results = [];
    let durationMs = duration.asMilliseconds();

    let startIndex = 0;
    let startTime = moment.unix(candles[0].timestamp);

    for (var i = 1; i < candles.length; i++) {
        let candle = candles[i];

        let now = moment.unix(candle.timestamp);
        let mdiff = moment.duration(now.diff(startTime)).asMilliseconds();
        if (mdiff >= durationMs) {
            // we reached the end of a period
            results.push(candles.slice(startIndex, i - 1));
            startTime = now;
            startIndex = i;
        }
    }

    // push the last "period" too
    results.push(candles.slice(startIndex));
    return results;
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
const labelTrends = function(candles, targetUp = 0.01, targetDown = 0.01) {
    let currentTrend = "still";
    let trendStartIndex = 0;
    let nbUp = 0;
    let nbDown = 0;

    // label candles after the trend start, but that still have a targetUp augmentation
    //  or targetDown diminution at the end of the trend
    let labelIntermediateCandles = function(startIndex, endIndex, trend, topTrendValue) {
        for (let i = startIndex; i <= endIndex; i++) {
            let candle = candles[i];

            if (trend == "up") {
                if (candle.close * (1 + targetUp) < topTrendValue) {
                    candle.trend = "up";
                    nbUp++;
                }
            } else if (trend == "down") {
                if (candle.close * (1 - targetDown) > topTrendValue) {
                    candle.trend = "down";
                    nbDown++;
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

    console.log(`{*] Labelled ${nbUp} uptrends and ${nbDown} downtrends on ${candles.length} periods`)
    return candles;
}

// remove 1m candles where the close price grew or shrink by more than 10% of the btc value over 1 min
removePriceAnomalies = function(candles) {
    let results = [];
    for (let i = 0; i < candles.length; i++) {
        let candle = candles[i];
        let relativeDifference = Math.abs(candle.close - candle.open) / candle.open;
        if (relativeDifference > 0.1) {
            // big relative difference, check if we also have a big difference with next candle
            if (i + 1 < candles.length) {
                let nextCandle = candles[i + 1];

                let nextCandleDifference = Math.abs(nextCandle.open - candle.close) / nextCandle.open;
                if (nextCandleDifference > 0.1) {
                    let m = moment.unix(candle.timestamp);
                    console.log(`removing anomaly at ${m.format('YYYY-MM-DD hh:mm')}: price ${candle.open.toFixed(0)}€ -> ${candle.close.toFixed(0)}€ -> ${nextCandle.close.toFixed(0)}€ in 2 minutes`);
                } else {
                    results.push(candle);
                }
            }
        } else {
            results.push(candle);
        }
    }
    return results;
}

const trend = function(candles) {
    return (candles[0].open - candles[candles.length - 1].close) / candles[0].open;
}

const variance = function(candles) {
    let mean = _.meanBy(candles, c => c.close);
    let differences = _.map(candles, c => Math.pow(c.close - mean, 2));
    return _.mean(differences);
}

// make a smooth connection between candles, based on last closed value
const connectCandles = function(samples) {
    let lastSample = samples[0];
    for (let i = 1; i < samples.length; i++) {
        let sample = samples[i];
        sample.open = lastSample.close;
        if (sample.open > sample.high) {
            sample.high = sample.open;
        }
        if (sample.open < sample.low) {
            sample.low = sample.open;
        }

        lastSample = sample;
    }
}

module.exports = {
    dataVariations,
    mergeCandles,
    getMax,
    splitData,
    kSplitData,
    cutDataBefore,
    cutDataAfter,
    equalize,
    breakData,
    rangeStr,
    labelTrends,
    splitByDuration,
    trend,
    variance,
    removePriceAnomalies,
    connectCandles
}