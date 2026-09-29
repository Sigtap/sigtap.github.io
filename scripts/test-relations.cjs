const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app.js','utf8');
const index=JSON.parse(fs.readFileSync('data/relations-index.json'));
const cat=JSON.parse(fs.readFileSync('data/catalog.json'));
const procedures=fs.readdirSync('data').filter(f=>/^group-/.test(f)).flatMap(f=>Object.values(JSON.parse(fs.readFileSync('data/'+f))));
const context=vm.createContext({relationIndex:index,Set});
vm.runInContext(source.slice(source.indexOf('const norm='),source.indexOf('const paths='))+source.slice(source.indexOf('const relationCode='),source.indexOf('function relationSuggestions')),context);
for(const kind of ['CID','CBO']){
 const expected=new Map();
 for(const p of procedures)for(const id of p.relations[kind]||[]){const code=cat[id][0];if(!expected.has(code))expected.set(code,new Set());expected.get(code).add(p.codigo)}
 for(const [code,name,codes] of index[kind]){
  assert.deepStrictEqual(new Set(codes),expected.get(code));
  context.kind=kind;context.query=code;
  assert.deepStrictEqual([...vm.runInContext('relationMatches(kind,query)',context)].sort(),codes);
 }
}
for(const [kind,query] of [['CID','A00.0'],['CBO','2251-25'],['CBO','medico'],['CID','zzinvalid'],['CID','']]){
 context.kind=kind;context.query=query;const value=vm.runInContext('relationMatches(kind,query)',context);console.log(kind,query,value?.size??'no filter');
 if(query==='zzinvalid')assert.equal(value.size,0);
 if(query==='')assert.equal(value,null);
}
assert.equal(procedures.length,JSON.parse(fs.readFileSync('data/index.json')).total);
console.log('All CID/CBO reverse mappings match source relationships; exact-code search verified.');
