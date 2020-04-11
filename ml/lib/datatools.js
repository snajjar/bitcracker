// data: array of arrays
// each sample will be the computed difference between the previous one
const computeDataVariations = function(data) {
    var calibrationData = data[0];
    var variations = [];

    for (let i = 1; i < data.length; i++) {
        var sample = data[i];
        var sampleVariations = [];

        for (let j = 0; j < sample.length; j++) {
            sampleVariations.push(sample[j] - calibrationData[j])
        }

        variations.push(sampleVariations);
        calibrationData = sample;
    }

    return variations;
}

const dataVariations = function(data) {
    let lastClosePrice = data[0].open;
    let maxHighVariation = 1;
    let minLowVariation = 1;

    console.log('[*] transforming price data into relative variations');

    for (let i = 0; i < data.length; i++) {
        let candle = data[i];

        let openVariation = candle.open / lastClosePrice; // should be 1
        let closeVariation = candle.close / lastClosePrice;
        let lowVariation = candle.low / lastClosePrice;
        let highVariation = candle.high / lastClosePrice;

        if (maxHighVariation < highVariation) {
            maxHighVariation = highVariation;
        }
        if (minLowVariation > lowVariation) {
            minLowVariation = lowVariation;
        }

        result.push({
            open: openVariation,
            close: closeVariation,
            high: highVariation,
            low: lowVariation,
            volume: candle.volume
        });
        lastClosePrice = candle.open;
    }

    console.log(`  - highest up variation: ${maxHighVariation}`);
    console.log(`  - highest down variation: ${minLowVariation}`);

    return result;
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
    computeDataVariations,
    getMax,
    splitData,
    kSplitData,
}