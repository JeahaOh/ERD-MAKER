import java.nio.file.*;
import java.util.*;
import org.eclipse.emf.common.util.URI;
import org.eclipse.emf.ecore.*;
import com.tomato.exerd.model.exerd.ExerdPackage;
import com.tomato.exerd.model.exerd.resource.ErdResourceImpl;
/** Independent local compatibility oracle. Vendor libraries never ship with the application. */
public final class OriginalExerdOracle {
 static String q(String s) {
  if(s==null) return "null";
  var out=new StringBuilder("\"");
  for(char c:s.toCharArray()) {
   if(c=='\\' || c=='\"') out.append('\\').append(c);
   else if(c<0x20) out.append(String.format("\\u%04x",(int)c));
   else out.append(c);
  }
  return out.append('\"').toString();
 }
 static List<EPackage> originalPackages() throws Exception {
  var packages=new ArrayList<EPackage>(); packages.add(ExerdPackage.eINSTANCE);
  for(var name:List.of(
    "com.tomato.exerd.product.postgresql.model.PostgreSQLPackage",
    "com.tomato.exerd.product.mysql.model.MySQLPackage",
    "com.tomato.exerd.product.oracle10g.physicalModel.Oracle10gPackage",
    "com.tomato.exerd.product.sqlserver.model.core.SqlServerPackage",
    "com.tomato.exerd.product.db2.model.core.DB2Package",
    "com.tomato.exerd.product.cubrid.model.CubridPackage",
    "com.tomato.exerd.product.mariadb.model.core.MariaDBPackage",
    "com.tomato.exerd.product.tibero.model.core.TiberoPackage")) {
   var pkg=(EPackage)Class.forName(name).getField("eINSTANCE").get(null);
   EPackage.Registry.INSTANCE.put(pkg.getNsURI(),pkg); packages.add(pkg);
  }
  return packages;
 }
 static void dumpMetadata() throws Exception {
  var packages=originalPackages();
  var rows=new ArrayList<String>();
  for(var pkg:packages) for(var cl:pkg.getEClassifiers()) if(cl instanceof EClass ec) {
   var features=new ArrayList<String>();
   for(var f:ec.getEAllStructuralFeatures()) {
    var km=Class.forName("com.tomato.exerd.model.exerd.resource.ErdResourceImpl$BinaryIO$FeatureKind").getDeclaredMethod("get",EStructuralFeature.class);
    km.setAccessible(true);
    String kind=((Enum<?>)km.invoke(null,f)).name();
    features.add(q(f.getName())+":{\"id\":"+ec.getFeatureID(f)+",\"kind\":"+q(kind)+",\"type\":"+q(f.getEType().getName())+",\"instanceClass\":"+q(f.getEType().getInstanceClassName())+",\"many\":"+f.isMany()+",\"transient\":"+f.isTransient()+",\"derived\":"+f.isDerived()+",\"defaultValue\":"+q(f.getDefaultValueLiteral())+"}");
   }
   rows.add(q(pkg.getNsURI()+"#"+ec.getName())+":{\"features\":{"+String.join(",",features)+"}}");
  }
  Files.writeString(Path.of(".analysis/oracle/output/metamodel.json"),"{"+String.join(",",rows)+"}\n");
 }
 static String value(EObject owner, EStructuralFeature f, Object value) {
  if(value==null) return "null";
  if(f.isMany()) {
   var vals=new ArrayList<String>();
   for(var v:(List<?>)value) vals.add(single(owner,f,v));
   return "["+String.join(",",vals)+"]";
  }
  return single(owner,f,value);
 }
 static String single(EObject owner, EStructuralFeature f,Object v) {
  if(v==null) return "null";
  if(v instanceof EObject target) return "{\"ref\":"+q(target.eIsProxy()?((InternalEObject)target).eProxyURI().toString():target.eResource().getURIFragment(target))+"}";
  var dt=(EDataType)f.getEType();
  return q(dt.getEPackage().getEFactoryInstance().convertToString(dt,v));
 }
 static void dumpGraph(org.eclipse.emf.ecore.resource.Resource r,String input) throws Exception {
  var objects=new ArrayList<EObject>();
  for(var root:r.getContents()) { objects.add(root); root.eAllContents().forEachRemaining(objects::add); }
  var rows=new ArrayList<String>();
  for(var obj:objects) {
   var fs=new TreeMap<String,String>();
   for(var f:obj.eClass().getEAllStructuralFeatures()) if(!f.isTransient() && !f.isDerived() && obj.eIsSet(f)) fs.put(f.getName(),value(obj,f,obj.eGet(f,false)));
   var fields=new ArrayList<String>();
   for(var e:fs.entrySet()) fields.add(q(e.getKey())+":"+e.getValue());
   rows.add(q(r.getURIFragment(obj))+":{\"type\":"+q(obj.eClass().getEPackage().getNsURI()+"#"+obj.eClass().getName())+",\"features\":{"+String.join(",",fields)+"}}");
  }
  var out=Path.of(".analysis/oracle/output/"+Path.of(input).getFileName()+".graph.json");
  Files.writeString(out,"{"+String.join(",",rows)+"}\n");
  System.err.println("graph="+out);
 }
 public static void main(String[] args) throws Exception {
  System.err.println("originalModelPackage="+ExerdPackage.eINSTANCE.getNsURI());
  for(var pkg:originalPackages()) System.err.println("registeredOriginalPackage="+pkg.getNsURI());
  dumpMetadata();
  boolean described=false;
  if(System.getenv().containsKey("ORACLE_DESCRIBE")) {
   var description=com.tomato.exerd.model.transform.IExerdContentDescriber.INSTANCE.describe(args[0], key -> { try { return new java.io.BufferedInputStream(Files.newInputStream(Path.of((String)key))); } catch(java.io.IOException e) { throw new java.io.UncheckedIOException(e); } });
   if(description==null) throw new IllegalArgumentException("Original GUI content describer rejected input");
   described=true;
   System.err.println("originalContentDescription="+description.getDocumentVersion()+"/"+description.getProductId());
  }
  boolean transformed=System.getenv().containsKey("ORACLE_TRANSFORM");
  org.eclipse.emf.ecore.resource.Resource resource = (System.getenv().containsKey("ORACLE_XML") || transformed)
    ? new com.tomato.exerd.model.exerd.resource.ERDXResourceImpl(URI.createFileURI(Path.of(args[0]).toAbsolutePath().toString()))
    : new ErdResourceImpl(URI.createFileURI(Path.of(args[0]).toAbsolutePath().toString()));
  var loadOptions=new HashMap<Object,Object>(com.tomato.exerd.model.exerd.resource.ExerdResourceOptions.getXMLLoadOptions());
  loadOptions.put("PROGRESS_MONITOR", new org.eclipse.core.runtime.NullProgressMonitor());
  if(transformed) {
   org.eclipse.emf.ecore.resource.Resource.Factory.Registry.INSTANCE.getExtensionToFactoryMap().put("ecore",new org.eclipse.emf.ecore.xmi.impl.EcoreResourceFactoryImpl());
   try(var stream=com.tomato.exerd.model.transform.ITransformService.INSTANCE.getTransformedContents(args[0], key -> {try{return new java.io.BufferedInputStream(Files.newInputStream(Path.of((String)key)));}catch(java.io.IOException e){throw new java.io.UncheckedIOException(e);}},new org.eclipse.core.runtime.NullProgressMonitor())) {
    var bytes=stream.readAllBytes();Files.write(Path.of(".analysis/oracle/output/"+Path.of(args[0]).getFileName()+".transformed.xml"),bytes);
    resource.load(new java.io.ByteArrayInputStream(bytes),loadOptions);
   }
  } else resource.load(loadOptions);
  var counts = new TreeMap<String,Integer>();
  for (var root : resource.getContents()) {
   counts.merge(root.eClass().getName(),1,Integer::sum);
   var it=root.eAllContents();
   while(it.hasNext()) counts.merge(it.next().eClass().getName(),1,Integer::sum);
  }
  System.err.println("objectCounts="+counts);
  System.err.println("resourceErrors="+resource.getErrors());
  if(!resource.getErrors().isEmpty()) throw new IllegalStateException("Original resource reported errors");
  dumpGraph(resource,args[0]);
  if(args.length>1) {
   try(var out=Files.newOutputStream(Path.of(args[1]))) { resource.save(out,Map.of("PROGRESS_MONITOR", new org.eclipse.core.runtime.NullProgressMonitor())); }
   System.err.println("saved="+args[1]);
  }

  var checks=new ArrayList<String>();
  var foreignKeyChecks=new ArrayList<String>();
  var groupChecks=new ArrayList<String>();
  var extraChecks=new ArrayList<String>();
  int semanticTableCount=0;
  for(var root:resource.getContents()) {
   var it=root.eAllContents();
   while(it.hasNext()) {
    var obj=it.next();
    if(obj instanceof com.tomato.exerd.model.exerd.ColumnGroup group) {
     var members=new ArrayList<String>();
     var membershipOwners=new ArrayList<String>();
     var indices=new ArrayList<String>();
     for(var member:group.getMember()) members.add(q(member.getUUID()));
     for(var membership:group.getMembership()) { membershipOwners.add(q(membership.getOwner()==null?null:membership.getOwner().getUUID())); indices.add(Integer.toString(membership.getEntryIndex())); }
     groupChecks.add("{\"uuid\":"+q(group.getUUID())+",\"type\":"+q(group.eClass().getName())+",\"memberColumns\":["+String.join(",",members)+"],\"membershipOwners\":["+String.join(",",membershipOwners)+"],\"membershipIndices\":["+String.join(",",indices)+"]}");
    }
    if(obj instanceof com.tomato.exerd.model.exerd.CheckConstraint check) extraChecks.add("{\"uuid\":"+q(check.getUUID())+",\"type\":\"CheckConstraint\",\"expression\":"+q(check.getExpression())+"}");
    if(obj instanceof com.tomato.exerd.model.exerd.Note note) extraChecks.add("{\"uuid\":"+q(note.getUUID())+",\"type\":\"Note\",\"text\":"+q(note.getText())+",\"target\":"+q(note.getTarget()==null?null:note.getTarget().getUUID())+",\"point\":"+q(String.valueOf(note.getLocation()))+",\"manualSize\":"+q(String.valueOf(note.getManualSize()))+"}");
    if(obj instanceof com.tomato.exerd.model.exerd.ForeignKeyColumnGroup fk) {
     var refs=new ArrayList<String>();
     for(var ref:fk.computeColumnReferences()) refs.add("{\"parent\":"+q(ref.getParentColumn()==null?null:ref.getParentColumn().getUUID())+",\"child\":"+q(ref.getChildColumn()==null?null:ref.getChildColumn().getUUID())+",\"index\":"+ref.getEntryIndex()+"}");
     foreignKeyChecks.add("{\"foreignKeyGroup\":"+q(fk.getUUID())+",\"parentTable\":"+q(fk.getParentTable()==null?null:fk.getParentTable().getUUID())+",\"childTable\":"+q(fk.getChildTable()==null?null:fk.getChildTable().getUUID())+",\"parentColumnGroup\":"+q(fk.getParentColumnGroup()==null?null:fk.getParentColumnGroup().getUUID())+",\"references\":["+String.join(",",refs)+"]}");
    }
    if(obj instanceof com.tomato.exerd.model.exerd.Table table) {
     semanticTableCount++;
     var pk=table.getPrimaryKeyColumnGroup();
     var members=new ArrayList<String>();
     if(pk!=null) for(var col:pk.getMember()) members.add(q(col.getUUID()));
     checks.add("{\"table\":"+q(table.getUUID())+",\"primaryKeyGroup\":"+q(pk==null?null:pk.getUUID())+",\"members\":["+String.join(",",members)+"],\"physicalPropertiesPresent\":"+table.eIsSet(table.eClass().getEStructuralFeature("physicalProperties"))+"}");
    }
   }
  }
  Files.writeString(Path.of(".analysis/oracle/output/"+Path.of(args[0]).getFileName()+".semantics.json"),"["+String.join(",",checks)+"]\n");
  Files.writeString(Path.of(".analysis/oracle/output/"+Path.of(args[0]).getFileName()+".groups.json"),"["+String.join(",",groupChecks)+"]\n");
  Files.writeString(Path.of(".analysis/oracle/output/"+Path.of(args[0]).getFileName()+".extras.json"),"["+String.join(",",extraChecks)+"]\n");
  Files.writeString(Path.of(".analysis/oracle/output/"+Path.of(args[0]).getFileName()+".foreign-keys.json"),"["+String.join(",",foreignKeyChecks)+"]\n");
  var countFields=new ArrayList<String>();
  for(var e:counts.entrySet()) countFields.add(q(e.getKey())+":"+e.getValue());
  var selected=new ArrayList<String>();
  for(var uuid:System.getenv().getOrDefault("ORACLE_SELECT_UUIDS", "").split(",")) if(!uuid.isEmpty()) {
   EObject obj=resource.getEObject(uuid);
   if(obj==null) throw new IllegalArgumentException("UUID not found: "+uuid);
   var vals=new ArrayList<String>();
   for(var name:List.of("UUID","logicalName","physicalName")) { var f=obj.eClass().getEStructuralFeature(name); if(f!=null) vals.add(q(name)+":"+q((String)obj.eGet(f))); }
   selected.add("{"+String.join(",",vals)+"}");
  }
  System.out.println("{\"reader\":\"eXERD 3.3.56 original "+resource.getClass().getSimpleName()+"\",\"contentDescriberVerified\":"+described+",\"originalTransformApplied\":"+transformed+",\"resourceErrors\":"+resource.getErrors().size()+",\"objectCounts\":{"+String.join(",",countFields)+"},\"selected\":["+String.join(",",selected)+"],\"uiReopenVerified\":false}");
 }
}
