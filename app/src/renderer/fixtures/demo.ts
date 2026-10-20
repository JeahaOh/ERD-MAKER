import { createModel, createTable, createColumn, newId, type Model } from '../../core/model';
export function demoModel(): Model {
  const model = createModel('Commerce · 주문 관리');
  model.subjects = [{ id: 'customer', name: '고객', color: '#0d9488' }, { id: 'order', name: '주문', color: '#6574d9' }, { id: 'catalog', name: '상품', color: '#c18a32' }];
  const definitions: [string, string, string, number, number, [string, string, string, boolean?][]][] = [
    ['customers', '고객', 'customer', 80, 80, [['customer_id', '고객 ID', 'BIGINT', true], ['email', '이메일', 'VARCHAR(255)'], ['name', '고객명', 'VARCHAR(100)'], ['phone', '연락처', 'VARCHAR(30)'], ['created_at', '가입일시', 'TIMESTAMP']]],
    ['orders', '주문', 'order', 500, 80, [['order_id', '주문 ID', 'BIGINT', true], ['customer_id', '고객 ID', 'BIGINT'], ['status', '주문 상태', 'VARCHAR(30)'], ['total_amount', '주문 금액', 'DECIMAL(12,2)'], ['ordered_at', '주문일시', 'TIMESTAMP']]],
    ['order_items', '주문 상품', 'order', 920, 80, [['order_id', '주문 ID', 'BIGINT', true], ['product_id', '상품 ID', 'BIGINT', true], ['quantity', '수량', 'INTEGER'], ['unit_price', '판매 단가', 'DECIMAL(12,2)']]],
    ['addresses', '배송지', 'customer', 80, 440, [['address_id', '배송지 ID', 'BIGINT', true], ['customer_id', '고객 ID', 'BIGINT'], ['recipient', '수령인', 'VARCHAR(100)'], ['postal_code', '우편번호', 'VARCHAR(10)'], ['address', '주소', 'VARCHAR(500)']]],
    ['payments', '결제', 'order', 500, 440, [['payment_id', '결제 ID', 'BIGINT', true], ['order_id', '주문 ID', 'BIGINT'], ['method', '결제 수단', 'VARCHAR(30)'], ['amount', '결제 금액', 'DECIMAL(12,2)'], ['paid_at', '결제일시', 'TIMESTAMP']]],
    ['products', '상품', 'catalog', 920, 440, [['product_id', '상품 ID', 'BIGINT', true], ['sku', '상품 코드', 'VARCHAR(50)'], ['name', '상품명', 'VARCHAR(200)'], ['price', '판매가', 'DECIMAL(12,2)'], ['stock', '재고', 'INTEGER']]],
  ];
  model.tables = definitions.map(([name, logicalName, subjectId, x, y, columns]) => {
    const table = createTable(name, x, y);
    Object.assign(table, { logicalName, subjectId, color: model.subjects.find(s => s.id === subjectId)!.color, comment: `${logicalName} 정보를 관리합니다.` });
    table.columns = columns.map(([name, logicalName, type, pk]) => ({ ...createColumn(name), logicalName, type, primaryKey: !!pk, nullable: false, unique: ['email', 'sku'].includes(name), defaultValue: ['created_at', 'ordered_at'].includes(name) ? 'CURRENT_TIMESTAMP' : name === 'quantity' ? '1' : '' }));
    return table;
  });
  for (const [parent, child, key] of [['customers', 'orders', 'customer_id'], ['customers', 'addresses', 'customer_id'], ['orders', 'order_items', 'order_id'], ['orders', 'payments', 'order_id'], ['products', 'order_items', 'product_id']]) {
    const p = model.tables.find(t => t.name === parent)!; const c = model.tables.find(t => t.name === child)!;
    model.relationships.push({ id: newId(), name: `fk_${child}_${parent}`, parentTableId: p.id, childTableId: c.id, parentColumnIds: [p.columns.find(col => col.name === key)!.id], childColumnIds: [c.columns.find(col => col.name === key)!.id], identifying: child === 'order_items', cardinality: '1:N', onDelete: 'NO ACTION' });
  }
  model.terms = [
    { id: newId(), logicalName: '생성일시', physicalName: 'created_at', type: 'TIMESTAMP', description: '데이터가 생성된 시각' },
    { id: newId(), logicalName: '수정일시', physicalName: 'updated_at', type: 'TIMESTAMP', description: '데이터가 마지막으로 변경된 시각' },
    { id: newId(), logicalName: '사용여부', physicalName: 'is_active', type: 'BOOLEAN', description: '사용 상태' },
  ];
  return model;
}
