import java.nio.file.*;
import java.util.*;
import org.eclipse.emf.ecore.*;
import org.eclipse.emf.common.util.URI;
import com.tomato.exerd.model.exerd.resource.ErdResourceImpl;
/** Synthetic fixtures built by each original package factory, never by changing a PG document's label. */
public final class OriginalDatabaseFixture {
 static EPackage core;
 static EObject make(EPackage pkg,String name) {
  var cl=pkg.getEClassifier(name);
  if(!(cl instanceof EClass ec) || ec.isAbstract()) throw new IllegalArgumentException("Missing concrete class "+pkg.getNsURI()+"#"+name);
  var o=pkg.getEFactoryInstance().create(ec);
  if(o.eClass().getEStructuralFeature("UUID")!=null) set(o,"UUID",name+"_"+UUID.randomUUID().toString().replace("-",""));
  return o;
 }
 static void set(EObject o,String key,Object value) {
  var f=o.eClass().getEStructuralFeature(key);
  if(f==null) throw new IllegalArgumentException(o.eClass().getName()+"."+key);
  if(f instanceof EAttribute a && value instanceof String s) value=a.getEAttributeType().getEPackage().getEFactoryInstance().createFromString(a.getEAttributeType(),s);
  o.eSet(f,value);
 }
 @SuppressWarnings("unchecked") static void add(EObject o,String key,EObject value) { ((List<EObject>)o.eGet(o.eClass().getEStructuralFeature(key))).add(value); }
 static EObject named(EPackage pkg,String cl,String name) { var o=make(pkg,cl);set(o,"physicalName",name);set(o,"logicalName",name);return o; }
 static EObject physical(EObject owner,EPackage pkg,String cl) {
  if(!(pkg.getEClassifier(cl) instanceof EClass ec) || ec.isAbstract()) return null;
  var o=make(pkg,cl);set(owner,"physicalProperties",o);return o;
 }
 static void member(EObject column,EObject group,String cl,int index,EObject parent) {
  var m=make(core,cl);set(m,"group",group);set(m,"entryIndex",index);
  if(parent!=null)set(m,"parentColumn",parent);else set(m,"sortType","ASC");
  var entry=make(core,"MembershipEntry");set(entry,"key",group);set(entry,"value",m);add(column,"memberships",entry);
 }
 static EObject[] table(EPackage db,EObject schema,EObject area,EObject diagram,String name,int x) {
  var table=named(core,"Table",name);set(table,"comment","Original factory compatibility fixture");physical(table,db,"TableProperties");
  var column=named(core,"Column","id");set(column,"dataType","INTEGER");set(column,"notNull","TRUE");physical(column,db,"ColumnProperties");add(table,"columns",column);
  var pk=named(core,"PrimaryKeyColumnGroup","pk_"+name);physical(pk,db,"IndexProperties");
  var constraint=named(core,"PrimaryKeyConstraint","pk_"+name);physical(constraint,db,"PrimaryKeyConstraintProperties");set(pk,"primaryKeyConstraint",constraint);add(table,"columnGroups",pk);member(column,pk,"PrimaryKeyMembership",0,null);
  var place=make(core,"TableDiagram");set(place,"table",table);set(place,"location","Point("+x+", 100)");add(schema,"tables",table);add(area,"tables",table);add(diagram,"diagramEntry",place);
  return new EObject[]{table,column,pk};
 }
 static void sample(EPackage pkg,String id,String family,Path out) throws Exception {
  var doc=make(core,"Document");set(doc,"version","3.3.56.20260820-1610");set(doc,"modelVersion","3.0.0.20190111-1604");set(doc,"productId",id);set(doc,"modelType","INTEGRATE");
  // databaseVersion intentionally remains the original factory default (null).
  // No unobserved provider version string or live-database compatibility is invented.
  var database=named(core,"DatabaseModel",family+" factory fixture");physical(database,pkg,"DatabaseProperties");set(doc,"databaseModel",database);
  var schema=named(core,"Schema","fixture_schema");physical(schema,pkg,"SchemaProperties");add(database,"schema",schema);set(doc,"activeSchema",schema);
  EObject area=named(core,"BusinessArea","fixture_area"),diagram=named(core,"Diagram","fixture_diagram");add(doc,"businessAreas",area);add(area,"diagrams",diagram);set(doc,"activeBusinessArea",area);add(doc,"openedDiagrams",diagram);
  var settings=make(core,"ViewSettings");set(diagram,"viewSettings",settings);set(diagram,"printSettings",make(core,"PrintSettings"));
  EObject config=make(core,"Configuration"),domain=make(core,"DomainDefinition");set(domain,"productId",id);set(domain,"version","3.0.0.20190111-1604");set(config,"domainDefinition",domain);set(doc,"configuration",config);set(doc,"sharedIcons",make(core,"SharedIcons"));
  var manager=make(core,"RelationManager");set(doc,"relationManager",manager);
  EObject[] parent=table(pkg,schema,area,diagram,"factory_parent",100),child=table(pkg,schema,area,diagram,"factory_child",500);
  var pc=named(core,"Column","parent_id");set(pc,"dataType","INTEGER");set(pc,"notNull","FALSE");physical(pc,pkg,"ColumnProperties");add(child[0],"columns",pc);
  var fk=named(core,"ForeignKeyColumnGroup","fk_factory_child");set(fk,"parentColumnGroup",parent[2]);set(fk,"useIndexing",false);
  var constraint=named(core,"ForeignKeyConstraint","fk_factory_child");physical(constraint,pkg,"ForeignKeyConstraintProperties");set(fk,"foreignKeyConstraint",constraint);add(child[0],"columnGroups",fk);member(pc,fk,"ColumnReference",0,parent[1]);
  var relation=make(core,"Relation");set(relation,"foreignKeyColumnGroup",fk);set(relation,"parentCardinalityType","ZERO_OR_ONE");set(relation,"childCardinalityType","ZERO_OR_MORE");var entry=make(core,"RelationEntry");set(entry,"key",fk);set(entry,"value",relation);add(manager,"relation",entry);
  var tableProps=(EObject)parent[0].eGet(parent[0].eClass().getEStructuralFeature("physicalProperties"));
  if(tableProps!=null) {
   if(family.equals("postgresql"))set(tableProps,"unlogged",true);
   if(family.equals("mysql"))set(tableProps,"characterSet","utf8mb4");
   if(family.equals("mariadb"))set(tableProps,"characterSet","utf8mb4");
   if(family.equals("oracle")||family.equals("tibero"))set(tableProps,"tablespaceName","USERS");
   if(family.equals("cubrid"))set(tableProps,"reuseOid","TRUE");
  }
  if(family.equals("sqlserver")) { var cp=(EObject)parent[1].eGet(parent[1].eClass().getEStructuralFeature("physicalProperties"));set(cp,"collationName","Latin1_General_CI_AS"); }
  var resource=new ErdResourceImpl(URI.createFileURI(out.toAbsolutePath().toString()));resource.getContents().add(doc);
  try(var stream=Files.newOutputStream(out)) { resource.save(stream,Map.of("PROGRESS_MONITOR",new org.eclipse.core.runtime.NullProgressMonitor())); }
  System.out.println(OriginalExerdOracle.q(family)+":"+OriginalExerdOracle.q(out.toString()));
 }
 public static void main(String[] args) throws Exception {
  var packages=OriginalExerdOracle.originalPackages();core=packages.get(0);var output=Path.of(args[0]);Files.createDirectories(output);
  var ids=List.of("com.tomato.db.postgresql","com.tomato.db.mysql","com.tomato.db.oracle_10g","com.tomato.db.sqlserver_2005","com.tomato.db.db2","com.tomato.db.cubrid10","com.tomato.db.mariadb","com.tomato.db.tibero");
  var names=List.of("postgresql","mysql","oracle","sqlserver","db2","cubrid","mariadb","tibero");
  for(int i=0;i<ids.size();i++) {var path=output.resolve(names.get(i)+"-original-factory.exerd");if(Files.exists(path))throw new IllegalArgumentException("Refusing overwrite: "+path);sample(packages.get(i+1),ids.get(i),names.get(i),path);}
 }
}
