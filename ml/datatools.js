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



module.exports = {
    computeDataVariations,
    getMax,
    splitData,
}