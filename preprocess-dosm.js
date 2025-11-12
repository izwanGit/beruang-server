// preprocess-dosm.js
const fs = require('fs');
const csv = require('csv-parser');

const LATEST_YEAR_HIES = '2022-01-01';
const LATEST_YEAR_POVERTY = '2022'; // Note: different format in this file

// Map state names from CSV to our app's state names if different
// In this case, they look compatible, but this is good practice.
const STATE_MAP = {
  'Johor': 'Johor',
  'Kedah': 'Kedah',
  'Kelantan': 'Kelantan',
  'Melaka': 'Melaka',
  'Negeri Sembilan': 'Negeri Sembilan',
  'Pahang': 'Pahang',
  'Pulau Pinang': 'Pulau Pinang',
  'Perak': 'Perak',
  'Perlis': 'Perlis',
  'Sabah': 'Sabah',
  'Sarawak': 'Sarawak',
  'Selangor': 'Selangor',
  'Terengganu': 'Terengganu',
  'W.P. Kuala Lumpur': 'W.P. Kuala Lumpur',
  'W.P. Labuan': 'W.P. Labuan',
  'W.P. Putrajaya': 'W.P. Putrajaya',
};

const ragData = {};

function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

async function processData() {
  try {
    // Read all 3 CSVs
    const hiesStateData = await readCSV('hies_state.csv');
    const povertyStateData = await readCSV('hh_poverty_state.csv');
    const percentileData = await readCSV('hies_malaysia_percentile.csv');

    // 1. Process hies_state.csv
    const latestHIES = hiesStateData.filter((row) => row.date === LATEST_YEAR_HIES);
    for (const row of latestHIES) {
      const stateName = STATE_MAP[row.state];
      if (stateName) {
        if (!ragData[stateName]) ragData[stateName] = {};
        ragData[stateName].income_mean = parseFloat(row.income_mean).toFixed(0);
        ragData[stateName].income_median = parseFloat(row.income_median).toFixed(0);
        ragData[stateName].expenditure_mean = parseFloat(row.expenditure_mean).toFixed(0);
        ragData[stateName].gini = parseFloat(row.gini).toFixed(3);
      }
    }

    // 2. Process hh_poverty_state.csv
    // Extracting PLI is tricky as it's not in hh_poverty_state.csv
    // We'll use the poverty incidence from hies_state.csv instead, which is cleaner.
    // Let's re-use latestHIES
    for (const row of latestHIES) {
       const stateName = STATE_MAP[row.state];
        if (stateName) {
            if (!ragData[stateName]) ragData[stateName] = {};
            ragData[stateName].poverty_rate_percent = parseFloat(row.poverty).toFixed(1);
        }
    }

    // 3. Process hies_malaysia_percentile.csv (National Data)
    // We'll create a special 'Nasional' key for this
    const latestPercentile = percentileData.filter(row => row.date.startsWith('2022') && row.variable === 'mean'); // 2024 data seems incomplete, using 2022
    if(latestPercentile.length === 0) {
        // Fallback to 2019 if 2022 is not available
        latestPercentile = percentileData.filter(row => row.date.startsWith('2019') && row.variable === 'mean');
    }

    const nationalData = {
        b40_mean: 0,
        m40_mean: 0,
        t20_mean: 0,
        b10_max: latestPercentile.find(r => r.percentile === '10')?.income || 'N/A',
        m40_median: latestPercentile.find(r => r.percentile === '50')?.income || 'N/A',
        t20_min: latestPercentile.find(r => r.percentile === '80')?.income || 'N/A',
    };
    
    // Quick calc for B40/M40/T20 means
    const b40incomes = latestPercentile.filter(r => parseInt(r.percentile) <= 40).map(r => parseFloat(r.income));
    const m40incomes = latestPercentile.filter(r => parseInt(r.percentile) > 40 && parseInt(r.percentile) <= 80).map(r => parseFloat(r.income));
    const t20incomes = latestPercentile.filter(r => parseInt(r.percentile) > 80).map(r => parseFloat(r.income));

    if(b40incomes.length > 0) nationalData.b40_mean = (b40incomes.reduce((a, b) => a + b, 0) / b40incomes.length).toFixed(0);
    if(m40incomes.length > 0) nationalData.m40_mean = (m40incomes.reduce((a, b) => a + b, 0) / m40incomes.length).toFixed(0);
    if(t20incomes.length > 0) nationalData.t20_mean = (t20incomes.reduce((a, b) => a + b, 0) / t20incomes.length).toFixed(0);
    
    ragData['Nasional'] = nationalData;


    // 4. Create text chunks for injection
    const finalRAGData = {};
    for (const stateName in ragData) {
      if (stateName === 'Nasional') continue;
      const d = ragData[stateName];
      finalRAGData[stateName] = `
Data for ${stateName} (DOSM 2022):
- Mean Income: RM ${d.income_mean}
- Median Income: RM ${d.income_median}
- Mean Expenditure: RM ${d.expenditure_mean}
- Poverty Rate: ${d.poverty_rate_percent}%
- Gini Coefficient: ${d.gini}
`.trim();
    }
    
    // Add National data as a separate key
    const n = ragData['Nasional'];
    finalRAGData['Nasional'] = `
National Data (DOSM 2022):
- B40 Mean Income: RM ${n.b40_mean}
- M40 Mean Income: RM ${n.m40_mean}
- T20 Mean Income: RM ${n.t20_mean}
- M40 Median (P50): RM ${n.m40_median}
- B40 Max (P10): RM ${n.b10_max}
- T20 Min (P80): RM ${n.t20_min}
`.trim();

    // 5. Write to JSON file
    fs.writeFileSync('dosm_data.json', JSON.stringify(finalRAGData, null, 2));
    console.log('✅ Successfully processed CSV data and created dosm_data.json');
    console.log('You can now start your main server (`node server.js`).');

  } catch (error) {
    console.error('Error processing CSV data:', error);
  }
}

processData();
