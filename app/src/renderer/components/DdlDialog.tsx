import { useEffect, useState } from 'react';
import { Download, RefreshCw, AlertCircle } from 'lucide-react';
import type { NativeDdlOptions, NativeDdlResult, NativeDialect } from '../../formats/sql/native-ddl';
import { Modal } from './ui';
import { download } from '../browser/exports';

export type GenerateDdl = (options: NativeDdlOptions) => Promise<NativeDdlResult | undefined>;
export function DdlDialog({ generate, close, filename, diagramTableUuids }: { generate: GenerateDdl; close: () => void; filename: string; diagramTableUuids: string[] }) {
  const [result, setResult] = useState<NativeDdlResult>(), [working, setWorking] = useState(false);
  const [dialect, setDialect] = useState<NativeDialect | ''>(''), [scope, setScope] = useState('all');
  useEffect(() => {
    let active = true; setWorking(true);
    generate({ dialect: dialect || undefined, tableUuids: scope === 'diagram' ? diagramTableUuids : undefined }).then(next => { if (active) { setResult(next); setWorking(false); } });
    return () => { active = false; };
  }, [generate, dialect, scope, diagramTableUuids]);
  return <Modal title="SQL 내보내기" subtitle="생성한 SQL을 확인한 후 데이터베이스에 적용하세요." close={close} wide>
    <div className="modal-body ddl-content"><div className="ddl-options"><label className="field"><span>데이터베이스</span><select aria-label="SQL 데이터베이스" value={dialect} onChange={e => setDialect(e.target.value as NativeDialect | '')}><option value="">모델의 DB 사용</option>{(['postgresql', 'mysql', 'mariadb', 'oracle', 'sqlserver', 'db2', 'tibero', 'cubrid'] as const).map(d => <option key={d} value={d}>{d}</option>)}</select></label><label className="field"><span>범위</span><select aria-label="SQL 내보내기 범위" value={scope} onChange={e => setScope(e.target.value)}><option value="all">전체 모델</option><option value="diagram">현재 다이어그램</option></select></label></div>
      {working ? <p className="help-text"><RefreshCw className="spin" size={14} /> SQL 생성 중</p> : result && <><p className="ddl-statistics">{result.statistics.tables} 테이블 · {result.statistics.columns} 컬럼 · {result.statistics.foreignKeys} 외래키 · {result.statistics.checks} CHECK</p>{!result.complete && <p className="export-warning"><AlertCircle size={14} />모든 옵션을 내보낼 수 없습니다. 아래 항목을 확인하세요.</p>}{result.unsupported.map((item, index) => <p key={index} className="export-warning">{item.message}</p>)}{result.diagnostics.map((item, index) => <p key={index} className={'help-text ' + (item.severity === 'error' ? 'export-warning' : '')}>{item.message}</p>)}<textarea className="sql-source" aria-label="생성 SQL" readOnly spellCheck={false} value={result.sql} /></>}
    </div><footer className="modal-actions"><button className="secondary-button" onClick={close}>닫기</button><button className="primary-button" disabled={working || !result?.complete || !result.sql} onClick={() => { if (result) download(result.sql, filename.replace(/\.exerd$/i, '') + '.sql', 'text/plain;charset=utf-8'); }}><Download size={14} />SQL 파일 저장</button></footer>
  </Modal>;
}
