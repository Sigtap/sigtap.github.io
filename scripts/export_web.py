"""Exporta a base do MVP, em leitura, para o explorador privado."""
from pathlib import Path
from dataclasses import asdict
from collections import defaultdict, Counter
from decimal import Decimal
import sys, json, hashlib, argparse, re
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from src.db import readonly_connection, validate_contract
from src.repository import SigtapRepository
from validate_sigtap_db import validate
parser=argparse.ArgumentParser(description='Valida e exporta uma competência SIGTAP para o site.')
parser.add_argument('database',type=Path)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
DB=args.database.resolve()
OUT=args.output.resolve()
OUT.mkdir(parents=True,exist_ok=True)
def save(name,data):
    (OUT/name).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'),default=lambda x:float(x) if isinstance(x,Decimal) else str(x)),encoding='utf-8')
with readonly_connection(DB) as c:
    validate_contract(c)
    repo=SigtapRepository(c)
    comps=repo.list_competencias()
    assert len(comps)==1 and re.fullmatch(r'20[0-9]{2}(0[1-9]|1[0-2])',comps[0]), 'Envie uma base com uma única competência válida'
    comp=comps[0]
    records={x.codigo:asdict(x) for x in repo.search(comp,'')}
    for p in records.values():
        p.pop('exige_cpf') # O rótulo exato do atributo é apresentado, sem inferir CPF a partir de CPF/CNS.
        p['relations']=defaultdict(list)
    groups=repo.hierarchy(comp)
    hierarchy={'groups':groups,'subgroups':{},'forms':{}}
    for g,_ in groups:
        hierarchy['subgroups'][g]=repo.hierarchy(comp,g)
        for s,_ in hierarchy['subgroups'][g]:
            hierarchy['forms'][s]=repo.hierarchy(comp,s)
    counts=Counter(k[:2] for k in records)
    assert set(counts)=={g for g,_ in groups},'Grupo faltante'
    assert len(records)==c.execute('select count(*) from tb_procedimento').fetchone()[0]
    forms={f for items in hierarchy['forms'].values() for f,_ in items}
    assert all(k[:6] in forms for k in records),'Hierarquia incompleta'
    catalog=[]; intern={}
    def add(kind,rows):
        for proc,code,name,condition in rows:
            if proc not in records: raise ValueError('Procedimento órfão: '+proc)
            item=(str(code) if code is not None else None,name,condition)
            key=(kind,*item)
            if key not in intern:
                intern[key]=len(catalog);catalog.append(item)
            records[proc]['relations'][kind].append(intern[key])
    specs=[('CBO','ocupacao','CO_OCUPACAO','NO_OCUPACAO',False),('CID','cid','CO_CID','NO_CID',False),('MODALIDADE','modalidade','CO_MODALIDADE','NO_MODALIDADE',True),('INSTRUMENTO','registro','CO_REGISTRO','NO_REGISTRO',True),('ATRIBUTO_COMPLEMENTAR','detalhe','CO_DETALHE','NO_DETALHE',True),('HABILITACAO','habilitacao','CO_HABILITACAO','NO_HABILITACAO',True)]
    for kind,table,key,name,dated in specs:
        condition="CASE WHEN r.ST_PRINCIPAL='S' THEN 'CID principal' ELSE 'CID relacionado' END" if kind=='CID' else "'Grupo ' || COALESCE(r.NU_GRUPO_HABILITACAO,'')" if kind=='HABILITACAO' else 'NULL'
        join=f' AND d.DT_COMPETENCIA=r.DT_COMPETENCIA' if dated else ''
        add(kind,c.execute(f'SELECT r.CO_PROCEDIMENTO,r.{key},d.{name},{condition} FROM rl_procedimento_{table} r JOIN tb_{table} d ON r.{key}=d.{key}{join} WHERE r.DT_COMPETENCIA=? ORDER BY 1,2',[comp]).fetchall())
    add('SERVICO_CLASSIFICACAO',c.execute("""SELECT r.CO_PROCEDIMENTO,r.CO_SERVICO||'/'||r.CO_CLASSIFICACAO,s.NO_SERVICO||' — '||d.NO_CLASSIFICACAO,NULL FROM rl_procedimento_servico r JOIN tb_servico s ON s.CO_SERVICO=r.CO_SERVICO AND s.DT_COMPETENCIA=r.DT_COMPETENCIA JOIN tb_servico_classificacao d ON d.CO_SERVICO=r.CO_SERVICO AND d.CO_CLASSIFICACAO=r.CO_CLASSIFICACAO AND d.DT_COMPETENCIA=r.DT_COMPETENCIA WHERE r.DT_COMPETENCIA=? ORDER BY 1,2""",[comp]).fetchall())
    add('COMPATIBILIDADE',c.execute("""SELECT r.CO_PROCEDIMENTO_PRINCIPAL,r.CO_PROCEDIMENTO_COMPATIVEL,p.NO_PROCEDIMENTO,'Tipo '||COALESCE(r.TP_COMPATIBILIDADE,'')||CASE WHEN r.QT_PERMITIDA IS NULL THEN '' ELSE '; quantidade permitida '||CAST(r.QT_PERMITIDA AS VARCHAR) END FROM rl_procedimento_compativel r JOIN tb_procedimento p ON p.CO_PROCEDIMENTO=r.CO_PROCEDIMENTO_COMPATIVEL AND p.DT_COMPETENCIA=r.DT_COMPETENCIA WHERE r.DT_COMPETENCIA=? ORDER BY 1,2""",[comp]).fetchall())
    add('REGRA_CONDICIONADA',c.execute("""SELECT r.CO_PROCEDIMENTO,r.CO_REGRA_CONDICIONADA,d.NO_REGRA_CONDICIONADA,d.DS_REGRA_CONDICIONADA FROM rl_procedimento_regra_cond r JOIN tb_regra_condicionada d USING(CO_REGRA_CONDICIONADA) ORDER BY 1,2""").fetchall())
    # Confronta a exportação em lote com o repositório original do MVP.
    samples=[next(k for k in records if k.startswith(g)) for g,_ in groups]+['0304020346','0202020010','0411010077']
    for code in samples:
        if code not in records: continue
        expected=Counter((r.tipo,r.codigo,r.nome,r.condicao) for r in repo.get_relations(comp,code))
        got=Counter((kind,*catalog[i]) for kind,ids in records[code]['relations'].items() for i in ids)
        assert expected==got,code
    report=validate(DB)
    report['database']='sigtap_'+comp+'.duckdb'
    assert report['checks']['duplicate_procedure_keys']==0
    assert report['checks']['invalid_procedure_code_length']==0
    assert not any(report['checks']['orphan_procedure_relations'].values()), 'Vínculos órfãos'
    report['sha256']=hashlib.sha256(DB.read_bytes()).hexdigest()
    report['groups']=[{'code':g,'name':n,'count':counts[g]} for g,n in groups]
    report['checks']['web_export_procedures']=len(records)
    report['checks']['web_export_relation_samples_match']=len(samples)
    report['checks']['web_export_hierarchy_orphans']=0
    report['checks']['web_export_all_groups_present']=True
    save('validation.json',report)
    save('catalog.json',catalog)
    save('index.json',{'competencia':comp,'total':len(records),'counts':dict(counts),'hierarchy':hierarchy,'procedures':[[p['codigo'],p['nome']] for p in records.values()],'sha256':report['sha256'],'withoutDescription':report['checks']['procedures_without_description']})
    for g,_ in groups:
        save('group-'+g+'.json',{k:v for k,v in records.items() if k.startswith(g)})
    print(json.dumps({'competencia':comp,'procedures':len(records),'groups':dict(counts),'relations':sum(len(ids) for p in records.values() for ids in p['relations'].values()),'catalog':len(catalog),'bytes':sum(p.stat().st_size for p in OUT.glob('*.json'))},indent=2))
