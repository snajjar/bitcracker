<template>
    <div id="chart">
        <apexchart type="candlestick" :options="options" height="600" :series="series"></apexchart>
    </div>
</template>

<style>
    .chart {
        color: black;
    }
</style>

<script>
import VueApexCharts from 'vue-apexcharts'

export default {
    props: [
        "series",
        "options"
    ],
    components: {
        "apexchart": VueApexCharts
    },
}
</script>