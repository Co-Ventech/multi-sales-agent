/**
 * Batch test runner for extractCompanyFromText
 * Reads all 12 batches from the test JSON and runs extraction on each job.
 */

const fs = require('fs');
const { extractAll } = require('./src/services/extractCompanyFromText');

const raw = JSON.parse(fs.readFileSync('../testingauth.upworkuserjobbatches.json', 'utf8'));
const doc = raw[Object.keys(raw)[0]];

let globalFound = 0;
let globalTotal = 0;
const SEP = '================================================================================';

for (let bi = 0; bi < doc.batches.length; bi++) {
  const batch = doc.batches[bi];
  const jobs = batch.jobs;
  const batchFound = [];
  const batchNoCompany = [];

  for (const job of jobs) {
    const desc = job.description || job.body || '';
    if (!desc) continue;

    const result = extractAll(desc);
    globalTotal++;

    if (result.company) {
      globalFound++;
      batchFound.push({ id: job.id, title: (job.title || '').substring(0, 60), company: result.company });
    } else {
      batchNoCompany.push({ id: job.id, title: (job.title || '').substring(0, 60) });
    }
  }

  console.log('\n' + SEP);
  console.log('BATCH ' + bi + ' | ' + batch.date + ' | ' + jobs.length + ' jobs | ' + batchFound.length + ' companies found');
  console.log(SEP);

  if (batchFound.length > 0) {
    console.log('\n--- Companies Found (' + batchFound.length + ') ---');
    batchFound.forEach(function(j) {
      console.log('  [' + j.id + '] "' + j.title + '"');
      console.log('          => ' + j.company);
    });
  }

  if (batchNoCompany.length > 0) {
    console.log('\n--- No Company Found (' + batchNoCompany.length + ') ---');
    batchNoCompany.slice(0, 10).forEach(function(j) {
      console.log('  [' + j.id + '] "' + j.title + '"');
    });
    if (batchNoCompany.length > 10) {
      console.log('  ... and ' + (batchNoCompany.length - 10) + ' more');
    }
  }
}

console.log('\n' + SEP);
console.log('GLOBAL RESULT: ' + globalFound + '/' + globalTotal + ' jobs had a company extracted');
console.log(SEP);