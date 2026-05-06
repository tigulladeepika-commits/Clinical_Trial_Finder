"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { TrialSearchFilters }                            from "@/types/trial";
import { validateCityStateAsync }                            from "@/lib/validation";

const STATUSES = [
  "",
  "Recruiting",
  "Active, not recruiting",
  "Not yet recruiting",
  "Enrolling by invitation",
  "Completed",
  "Terminated",
  "Suspended",
  "Withdrawn",
] as const;

const PHASES = ["", "Phase 1", "Phase 2", "Phase 3", "Phase 4", "N/A"] as const;

const US_STATES = [
  { code: "AL", label: "Alabama" },
  { code: "AK", label: "Alaska" },
  { code: "AZ", label: "Arizona" },
  { code: "AR", label: "Arkansas" },
  { code: "CA", label: "California" },
  { code: "CO", label: "Colorado" },
  { code: "CT", label: "Connecticut" },
  { code: "DE", label: "Delaware" },
  { code: "FL", label: "Florida" },
  { code: "GA", label: "Georgia" },
  { code: "HI", label: "Hawaii" },
  { code: "ID", label: "Idaho" },
  { code: "IL", label: "Illinois" },
  { code: "IN", label: "Indiana" },
  { code: "IA", label: "Iowa" },
  { code: "KS", label: "Kansas" },
  { code: "KY", label: "Kentucky" },
  { code: "LA", label: "Louisiana" },
  { code: "ME", label: "Maine" },
  { code: "MD", label: "Maryland" },
  { code: "MA", label: "Massachusetts" },
  { code: "MI", label: "Michigan" },
  { code: "MN", label: "Minnesota" },
  { code: "MS", label: "Mississippi" },
  { code: "MO", label: "Missouri" },
  { code: "MT", label: "Montana" },
  { code: "NE", label: "Nebraska" },
  { code: "NV", label: "Nevada" },
  { code: "NH", label: "New Hampshire" },
  { code: "NJ", label: "New Jersey" },
  { code: "NM", label: "New Mexico" },
  { code: "NY", label: "New York" },
  { code: "NC", label: "North Carolina" },
  { code: "ND", label: "North Dakota" },
  { code: "OH", label: "Ohio" },
  { code: "OK", label: "Oklahoma" },
  { code: "OR", label: "Oregon" },
  { code: "PA", label: "Pennsylvania" },
  { code: "RI", label: "Rhode Island" },
  { code: "SC", label: "South Carolina" },
  { code: "SD", label: "South Dakota" },
  { code: "TN", label: "Tennessee" },
  { code: "TX", label: "Texas" },
  { code: "UT", label: "Utah" },
  { code: "VT", label: "Vermont" },
  { code: "VA", label: "Virginia" },
  { code: "WA", label: "Washington" },
  { code: "WV", label: "West Virginia" },
  { code: "WI", label: "Wisconsin" },
  { code: "WY", label: "Wyoming" },
] as const;

const STATE_CODE_TO_LABEL: Record<string, string> = Object.fromEntries(
  US_STATES.map((s) => [s.code, s.label])
);

// ── Exhaustive city → state tuple list ───────────────────────────────────────
// Same city name can appear under multiple states without any duplicate-key error.
const CITY_STATE_LIST: [string, string][] = [
  // Alabama
  ["birmingham","AL"],["montgomery","AL"],["huntsville","AL"],["mobile","AL"],
  ["tuscaloosa","AL"],["hoover","AL"],["dothan","AL"],["auburn","AL"],
  ["decatur","AL"],["madison","AL"],["florence","AL"],["gadsden","AL"],
  ["vestavia hills","AL"],["prattville","AL"],["phenix city","AL"],
  ["alabaster","AL"],["bessemer","AL"],["enterprise","AL"],["opelika","AL"],
  ["homewood","AL"],["northport","AL"],["anniston","AL"],["prichard","AL"],
  ["athens","AL"],
  // Alaska
  ["anchorage","AK"],["fairbanks","AK"],["juneau","AK"],["sitka","AK"],
  ["ketchikan","AK"],["wasilla","AK"],["kenai","AK"],["kodiak","AK"],
  ["bethel","AK"],["palmer","AK"],
  // Arizona
  ["phoenix","AZ"],["tucson","AZ"],["mesa","AZ"],["chandler","AZ"],
  ["scottsdale","AZ"],["glendale","AZ"],["tempe","AZ"],["gilbert","AZ"],
  ["peoria","AZ"],["surprise","AZ"],["yuma","AZ"],["avondale","AZ"],
  ["flagstaff","AZ"],["goodyear","AZ"],["buckeye","AZ"],
  ["lake havasu city","AZ"],["casa grande","AZ"],["sierra vista","AZ"],
  ["maricopa","AZ"],["oro valley","AZ"],["prescott","AZ"],
  ["bullhead city","AZ"],["prescott valley","AZ"],["apache junction","AZ"],
  ["queen creek","AZ"],
  // Arkansas
  ["little rock","AR"],["fort smith","AR"],["fayetteville","AR"],
  ["springdale","AR"],["jonesboro","AR"],["north little rock","AR"],
  ["conway","AR"],["rogers","AR"],["bentonville","AR"],["pine bluff","AR"],
  ["hot springs","AR"],["benton","AR"],["texarkana","AR"],["sherwood","AR"],
  ["jacksonville","AR"],["russellville","AR"],["bella vista","AR"],
  ["west memphis","AR"],["paragould","AR"],["cabot","AR"],
  // California
  ["los angeles","CA"],["san diego","CA"],["san jose","CA"],
  ["san francisco","CA"],["fresno","CA"],["sacramento","CA"],
  ["long beach","CA"],["oakland","CA"],["bakersfield","CA"],
  ["anaheim","CA"],["santa ana","CA"],["riverside","CA"],
  ["stockton","CA"],["irvine","CA"],["chula vista","CA"],
  ["fremont","CA"],["san bernardino","CA"],["modesto","CA"],
  ["fontana","CA"],["moreno valley","CA"],["glendale","CA"],
  ["huntington beach","CA"],["santa clarita","CA"],["garden grove","CA"],
  ["palo alto","CA"],["pasadena","CA"],["torrance","CA"],["pomona","CA"],
  ["escondido","CA"],["sunnyvale","CA"],["hayward","CA"],["salinas","CA"],
  ["santa rosa","CA"],["roseville","CA"],["ontario","CA"],
  ["elk grove","CA"],["corona","CA"],["lancaster","CA"],
  ["palmdale","CA"],["vallejo","CA"],["ventura","CA"],
  ["san buenaventura","CA"],["berkeley","CA"],["santa barbara","CA"],
  ["oxnard","CA"],["thousand oaks","CA"],["simi valley","CA"],
  ["concord","CA"],["visalia","CA"],["santa clara","CA"],
  ["victorville","CA"],["el monte","CA"],["downey","CA"],
  ["costa mesa","CA"],["inglewood","CA"],["carlsbad","CA"],
  ["west covina","CA"],["norwalk","CA"],["burbank","CA"],
  ["daly city","CA"],["murrieta","CA"],["temecula","CA"],
  ["richmond","CA"],["antioch","CA"],["santa maria","CA"],
  ["el cajon","CA"],["fairfield","CA"],["san mateo","CA"],
  ["clovis","CA"],["redding","CA"],["south gate","CA"],
  ["vista","CA"],["vacaville","CA"],["carson","CA"],
  ["livermore","CA"],["hesperia","CA"],["westminster","CA"],
  ["santa monica","CA"],["hawthorne","CA"],["san leandro","CA"],
  ["chico","CA"],["whittier","CA"],["newport beach","CA"],
  ["alhambra","CA"],["san marcos","CA"],["fullerton","CA"],
  ["orange","CA"],
  // Colorado
  ["denver","CO"],["colorado springs","CO"],["aurora","CO"],
  ["fort collins","CO"],["lakewood","CO"],["thornton","CO"],
  ["arvada","CO"],["westminster","CO"],["boulder","CO"],
  ["pueblo","CO"],["centennial","CO"],["highlands ranch","CO"],
  ["greeley","CO"],["longmont","CO"],["loveland","CO"],
  ["broomfield","CO"],["castle rock","CO"],["commerce city","CO"],
  ["parker","CO"],["northglenn","CO"],["brighton","CO"],
  // Connecticut
  ["bridgeport","CT"],["new haven","CT"],["stamford","CT"],
  ["hartford","CT"],["waterbury","CT"],["norwalk","CT"],
  ["danbury","CT"],["new britain","CT"],["meriden","CT"],
  ["west haven","CT"],["milford","CT"],["stratford","CT"],
  ["east hartford","CT"],["middletown","CT"],["norwich","CT"],
  // Delaware
  ["wilmington","DE"],["dover","DE"],["newark","DE"],
  ["middletown","DE"],["smyrna","DE"],["milford","DE"],
  ["seaford","DE"],["georgetown","DE"],["elsmere","DE"],
  // Florida
  ["jacksonville","FL"],["miami","FL"],["tampa","FL"],["orlando","FL"],
  ["st. petersburg","FL"],["hialeah","FL"],["tallahassee","FL"],
  ["fort lauderdale","FL"],["port st. lucie","FL"],["cape coral","FL"],
  ["pembroke pines","FL"],["hollywood","FL"],["gainesville","FL"],
  ["miramar","FL"],["coral springs","FL"],["clearwater","FL"],
  ["palm bay","FL"],["west palm beach","FL"],["pompano beach","FL"],
  ["lakeland","FL"],["davie","FL"],["miami gardens","FL"],
  ["boca raton","FL"],["deltona","FL"],["naples","FL"],
  ["sarasota","FL"],["pensacola","FL"],["sunrise","FL"],
  ["fort myers","FL"],["palm coast","FL"],["brandon","FL"],
  ["spring hill","FL"],["kissimmee","FL"],["miami beach","FL"],
  ["deerfield beach","FL"],["boynton beach","FL"],["lauderhill","FL"],
  ["daytona beach","FL"],["homestead","FL"],["delray beach","FL"],
  ["melbourne","FL"],["largo","FL"],["palm harbor","FL"],
  ["ocala","FL"],["port orange","FL"],
  // Georgia
  ["atlanta","GA"],["columbus","GA"],["savannah","GA"],["augusta","GA"],
  ["athens","GA"],["macon","GA"],["sandy springs","GA"],["roswell","GA"],
  ["johns creek","GA"],["albany","GA"],["warner robins","GA"],
  ["alpharetta","GA"],["marietta","GA"],["smyrna","GA"],
  ["peachtree city","GA"],["brookhaven","GA"],["dunwoody","GA"],
  ["south fulton","GA"],["rome","GA"],["valdosta","GA"],
  ["east point","GA"],["gainesville","GA"],
  // Hawaii
  ["honolulu","HI"],["pearl city","HI"],["hilo","HI"],
  ["kailua","HI"],["waipahu","HI"],["kaneohe","HI"],
  ["mililani","HI"],["kahului","HI"],["ewa beach","HI"],
  ["kihei","HI"],["makakilo","HI"],
  // Idaho
  ["boise","ID"],["meridian","ID"],["nampa","ID"],["idaho falls","ID"],
  ["pocatello","ID"],["caldwell","ID"],["coeur d'alene","ID"],
  ["twin falls","ID"],["lewiston","ID"],["post falls","ID"],
  ["rexburg","ID"],["moscow","ID"],
  // Illinois
  ["chicago","IL"],["aurora","IL"],["rockford","IL"],["joliet","IL"],
  ["naperville","IL"],["springfield","IL"],["peoria","IL"],["elgin","IL"],
  ["waukegan","IL"],["champaign","IL"],["evanston","IL"],
  ["cicero","IL"],["bloomington","IL"],["arlington heights","IL"],
  ["bolingbrook","IL"],["decatur","IL"],["palatine","IL"],
  ["schaumburg","IL"],["skokie","IL"],["des plaines","IL"],
  ["orland park","IL"],["tinley park","IL"],["oak lawn","IL"],
  ["berwyn","IL"],["mount prospect","IL"],["normal","IL"],
  ["wheaton","IL"],["downers grove","IL"],["oak park","IL"],
  ["gurnee","IL"],["carol stream","IL"],
  // Indiana
  ["indianapolis","IN"],["fort wayne","IN"],["evansville","IN"],
  ["south bend","IN"],["carmel","IN"],["fishers","IN"],
  ["hammond","IN"],["gary","IN"],["muncie","IN"],
  ["bloomington","IN"],["lafayette","IN"],["terre haute","IN"],
  ["anderson","IN"],["noblesville","IN"],["greenwood","IN"],
  ["kokomo","IN"],["elkhart","IN"],["mishawaka","IN"],
  ["lawrence","IN"],["jeffersonville","IN"],
  // Iowa
  ["des moines","IA"],["cedar rapids","IA"],["davenport","IA"],
  ["sioux city","IA"],["iowa city","IA"],["waterloo","IA"],
  ["ames","IA"],["council bluffs","IA"],["dubuque","IA"],
  ["ankeny","IA"],["west des moines","IA"],["cedar falls","IA"],
  ["marion","IA"],["urbandale","IA"],["bettendorf","IA"],
  // Kansas
  ["wichita","KS"],["overland park","KS"],["kansas city","KS"],
  ["topeka","KS"],["olathe","KS"],["lawrence","KS"],
  ["shawnee","KS"],["manhattan","KS"],["lenexa","KS"],
  ["salina","KS"],["hutchinson","KS"],["leavenworth","KS"],
  ["leawood","KS"],["dodge city","KS"],["garden city","KS"],
  // Kentucky
  ["louisville","KY"],["lexington","KY"],["bowling green","KY"],
  ["owensboro","KY"],["covington","KY"],["hopkinsville","KY"],
  ["richmond","KY"],["florence","KY"],["georgetown","KY"],
  ["elizabethtown","KY"],["nicholasville","KY"],["henderson","KY"],
  ["frankfort","KY"],["jeffersontown","KY"],["paducah","KY"],
  // Louisiana
  ["new orleans","LA"],["baton rouge","LA"],["shreveport","LA"],
  ["metairie","LA"],["lafayette","LA"],["lake charles","LA"],
  ["kenner","LA"],["bossier city","LA"],["monroe","LA"],
  ["alexandria","LA"],["houma","LA"],["new iberia","LA"],
  ["laplace","LA"],["slidell","LA"],["prairieville","LA"],
  // Maine
  ["portland","ME"],["lewiston","ME"],["bangor","ME"],
  ["south portland","ME"],["auburn","ME"],["biddeford","ME"],
  ["sanford","ME"],["saco","ME"],["augusta","ME"],
  ["westbrook","ME"],["waterville","ME"],["brewer","ME"],
  // Maryland
  ["baltimore","MD"],["columbia","MD"],["silver spring","MD"],
  ["germantown","MD"],["bethesda","MD"],["frederick","MD"],
  ["rockville","MD"],["ellicott city","MD"],["dundalk","MD"],
  ["gaithersburg","MD"],["bowie","MD"],["hagerstown","MD"],
  ["annapolis","MD"],["towson","MD"],["glen burnie","MD"],
  ["waldorf","MD"],["college park","MD"],["salisbury","MD"],
  // Massachusetts
  ["boston","MA"],["worcester","MA"],["springfield","MA"],
  ["cambridge","MA"],["lowell","MA"],["brockton","MA"],
  ["new bedford","MA"],["quincy","MA"],["lynn","MA"],
  ["fall river","MA"],["newton","MA"],["somerville","MA"],
  ["haverhill","MA"],["waltham","MA"],["malden","MA"],
  ["brookline","MA"],["plymouth","MA"],["medford","MA"],
  ["taunton","MA"],["chicopee","MA"],["weymouth","MA"],
  ["revere","MA"],["peabody","MA"],["methuen","MA"],
  ["barnstable","MA"],["pittsfield","MA"],["attleboro","MA"],
  ["salem","MA"],["westfield","MA"],["holyoke","MA"],
  // Michigan
  ["detroit","MI"],["grand rapids","MI"],["warren","MI"],
  ["sterling heights","MI"],["ann arbor","MI"],["lansing","MI"],
  ["flint","MI"],["dearborn","MI"],["livonia","MI"],
  ["westland","MI"],["troy","MI"],["kalamazoo","MI"],
  ["farmington hills","MI"],["clinton township","MI"],["pontiac","MI"],
  ["royal oak","MI"],["novi","MI"],["dearborn heights","MI"],
  ["taylor","MI"],["st. clair shores","MI"],["saginaw","MI"],
  ["kentwood","MI"],["east lansing","MI"],["roseville","MI"],
  ["portage","MI"],["wyoming","MI"],["southfield","MI"],
  // Minnesota
  ["minneapolis","MN"],["saint paul","MN"],["st. paul","MN"],
  ["rochester","MN"],["duluth","MN"],["bloomington","MN"],
  ["brooklyn park","MN"],["plymouth","MN"],["maple grove","MN"],
  ["woodbury","MN"],["st. cloud","MN"],["eagan","MN"],
  ["eden prairie","MN"],["coon rapids","MN"],["burnsville","MN"],
  ["blaine","MN"],["lakeville","MN"],["minnetonka","MN"],
  ["apple valley","MN"],["edina","MN"],["st. louis park","MN"],
  ["mankato","MN"],["moorhead","MN"],["brooklyn center","MN"],
  // Mississippi
  ["jackson","MS"],["gulfport","MS"],["southaven","MS"],
  ["hattiesburg","MS"],["biloxi","MS"],["meridian","MS"],
  ["tupelo","MS"],["olive branch","MS"],["greenville","MS"],
  ["horn lake","MS"],["clinton","MS"],["pearl","MS"],
  ["ridgeland","MS"],["starkville","MS"],["brandon","MS"],
  // Missouri
  ["kansas city","MO"],["st. louis","MO"],["saint louis","MO"],
  ["springfield","MO"],["columbia","MO"],["independence","MO"],
  ["lee's summit","MO"],["o'fallon","MO"],["st. joseph","MO"],
  ["st. charles","MO"],["st. peters","MO"],["blue springs","MO"],
  ["florissant","MO"],["joplin","MO"],["chesterfield","MO"],
  ["jefferson city","MO"],["cape girardeau","MO"],["wildwood","MO"],
  // Montana
  ["billings","MT"],["missoula","MT"],["great falls","MT"],
  ["bozeman","MT"],["butte","MT"],["helena","MT"],
  ["kalispell","MT"],["havre","MT"],["anaconda","MT"],
  // Nebraska
  ["omaha","NE"],["lincoln","NE"],["bellevue","NE"],
  ["grand island","NE"],["kearney","NE"],["fremont","NE"],
  ["hastings","NE"],["north platte","NE"],["norfolk","NE"],
  ["columbus","NE"],
  // Nevada
  ["las vegas","NV"],["henderson","NV"],["reno","NV"],
  ["north las vegas","NV"],["sparks","NV"],["carson city","NV"],
  ["sunrise manor","NV"],["enterprise","NV"],["spring valley","NV"],
  ["paradise","NV"],["whitney","NV"],["winchester","NV"],
  ["boulder city","NV"],["mesquite","NV"],
  // New Hampshire
  ["manchester","NH"],["nashua","NH"],["concord","NH"],
  ["derry","NH"],["dover","NH"],["rochester","NH"],
  ["salem","NH"],["merrimack","NH"],["londonderry","NH"],
  ["hudson","NH"],["keene","NH"],["portsmouth","NH"],
  ["laconia","NH"],["lebanon","NH"],
  // New Jersey
  ["newark","NJ"],["jersey city","NJ"],["paterson","NJ"],
  ["elizabeth","NJ"],["trenton","NJ"],["camden","NJ"],
  ["passaic","NJ"],["clifton","NJ"],["east orange","NJ"],
  ["bayonne","NJ"],["vineland","NJ"],["union city","NJ"],
  ["new brunswick","NJ"],["perth amboy","NJ"],["hoboken","NJ"],
  ["plainfield","NJ"],["hackensack","NJ"],["kearny","NJ"],
  ["west new york","NJ"],["linden","NJ"],
  // New Mexico
  ["albuquerque","NM"],["las cruces","NM"],["rio rancho","NM"],
  ["santa fe","NM"],["roswell","NM"],["farmington","NM"],
  ["clovis","NM"],["hobbs","NM"],["alamogordo","NM"],
  ["carlsbad","NM"],["gallup","NM"],["los lunas","NM"],
  // New York
  ["new york","NY"],["new york city","NY"],["nyc","NY"],
  ["buffalo","NY"],["rochester","NY"],["yonkers","NY"],
  ["syracuse","NY"],["albany","NY"],["new rochelle","NY"],
  ["mount vernon","NY"],["schenectady","NY"],["utica","NY"],
  ["brooklyn","NY"],["queens","NY"],["bronx","NY"],
  ["manhattan","NY"],["staten island","NY"],["white plains","NY"],
  ["brentwood","NY"],["valley stream","NY"],["hempstead","NY"],
  ["troy","NY"],["niagara falls","NY"],
  // North Carolina
  ["charlotte","NC"],["raleigh","NC"],["greensboro","NC"],
  ["durham","NC"],["winston-salem","NC"],["fayetteville","NC"],
  ["cary","NC"],["wilmington","NC"],["high point","NC"],
  ["concord","NC"],["chapel hill","NC"],["asheville","NC"],
  ["gastonia","NC"],["jacksonville","NC"],["rocky mount","NC"],
  ["burlington","NC"],["huntersville","NC"],["apex","NC"],
  ["kannapolis","NC"],["greenville","NC"],["mooresville","NC"],
  // North Dakota
  ["fargo","ND"],["bismarck","ND"],["grand forks","ND"],
  ["minot","ND"],["west fargo","ND"],["mandan","ND"],
  ["jamestown","ND"],["dickinson","ND"],["wahpeton","ND"],
  // Ohio
  ["columbus","OH"],["cleveland","OH"],["cincinnati","OH"],
  ["toledo","OH"],["akron","OH"],["dayton","OH"],["parma","OH"],
  ["canton","OH"],["youngstown","OH"],["lorain","OH"],
  ["hamilton","OH"],["springfield","OH"],["kettering","OH"],
  ["elyria","OH"],["lakewood","OH"],["cuyahoga falls","OH"],
  ["euclid","OH"],["newark","OH"],["mansfield","OH"],
  ["middletown","OH"],["mentor","OH"],["beavercreek","OH"],
  ["cleveland heights","OH"],["strongsville","OH"],
  // Oklahoma
  ["oklahoma city","OK"],["tulsa","OK"],["norman","OK"],
  ["broken arrow","OK"],["lawton","OK"],["edmond","OK"],
  ["moore","OK"],["midwest city","OK"],["enid","OK"],
  ["stillwater","OK"],["muskogee","OK"],["bartlesville","OK"],
  ["owasso","OK"],["shawnee","OK"],["yukon","OK"],
  // Oregon
  ["portland","OR"],["eugene","OR"],["salem","OR"],["gresham","OR"],
  ["hillsboro","OR"],["beaverton","OR"],["bend","OR"],
  ["medford","OR"],["springfield","OR"],["corvallis","OR"],
  ["albany","OR"],["tigard","OR"],["lake oswego","OR"],
  ["keizer","OR"],["grants pass","OR"],["oregon city","OR"],
  ["mcminnville","OR"],["redmond","OR"],["tualatin","OR"],
  // Pennsylvania
  ["philadelphia","PA"],["pittsburgh","PA"],["allentown","PA"],
  ["erie","PA"],["reading","PA"],["scranton","PA"],
  ["bethlehem","PA"],["lancaster","PA"],["harrisburg","PA"],
  ["york","PA"],["altoona","PA"],["wilkes-barre","PA"],
  ["chester","PA"],["norristown","PA"],["williamsport","PA"],
  ["easton","PA"],["lebanon","PA"],["hazleton","PA"],
  // Rhode Island
  ["providence","RI"],["warwick","RI"],["cranston","RI"],
  ["pawtucket","RI"],["east providence","RI"],["woonsocket","RI"],
  ["coventry","RI"],["cumberland","RI"],["north providence","RI"],
  // South Carolina
  ["columbia","SC"],["charleston","SC"],["north charleston","SC"],
  ["greenville","SC"],["rock hill","SC"],["spartanburg","SC"],
  ["mount pleasant","SC"],["summerville","SC"],["hilton head island","SC"],
  ["florence","SC"],["goose creek","SC"],["anderson","SC"],
  ["myrtle beach","SC"],["greer","SC"],["sumter","SC"],
  // South Dakota
  ["sioux falls","SD"],["rapid city","SD"],["aberdeen","SD"],
  ["brookings","SD"],["watertown","SD"],["mitchell","SD"],
  ["yankton","SD"],["pierre","SD"],
  // Tennessee
  ["memphis","TN"],["nashville","TN"],["knoxville","TN"],
  ["chattanooga","TN"],["clarksville","TN"],["murfreesboro","TN"],
  ["franklin","TN"],["jackson","TN"],["johnson city","TN"],
  ["bartlett","TN"],["hendersonville","TN"],["kingsport","TN"],
  ["collierville","TN"],["smyrna","TN"],["germantown","TN"],
  ["brentwood","TN"],["columbia","TN"],["spring hill","TN"],
  // Texas
  ["houston","TX"],["san antonio","TX"],["dallas","TX"],
  ["austin","TX"],["fort worth","TX"],["el paso","TX"],
  ["arlington","TX"],["corpus christi","TX"],["plano","TX"],
  ["laredo","TX"],["lubbock","TX"],["irving","TX"],
  ["garland","TX"],["frisco","TX"],["mckinney","TX"],
  ["amarillo","TX"],["grand prairie","TX"],["brownsville","TX"],
  ["pasadena","TX"],["killeen","TX"],["mesquite","TX"],
  ["midland","TX"],["mcallen","TX"],["waco","TX"],
  ["denton","TX"],["carrollton","TX"],["abilene","TX"],
  ["beaumont","TX"],["round rock","TX"],["odessa","TX"],
  ["lewisville","TX"],["tyler","TX"],["college station","TX"],
  ["pearland","TX"],["richardson","TX"],["allen","TX"],
  ["sugar land","TX"],["league city","TX"],["edinburg","TX"],
  ["cedar park","TX"],["san angelo","TX"],["longview","TX"],
  ["pharr","TX"],["new braunfels","TX"],["conroe","TX"],
  ["bryan","TX"],["wichita falls","TX"],["mission","TX"],
  ["temple","TX"],["baytown","TX"],["north richland hills","TX"],
  ["atascocita","TX"],["flower mound","TX"],["harlingen","TX"],
  ["victoria","TX"],["port arthur","TX"],["wylie","TX"],
  ["leander","TX"],["burleson","TX"],
  // Utah
  ["salt lake city","UT"],["west valley city","UT"],["provo","UT"],
  ["west jordan","UT"],["orem","UT"],["ogden","UT"],
  ["st. george","UT"],["layton","UT"],["taylorsville","UT"],
  ["south jordan","UT"],["millcreek","UT"],["lehi","UT"],
  ["clearfield","UT"],["murray","UT"],["draper","UT"],
  ["spanish fork","UT"],["logan","UT"],["riverton","UT"],
  ["herriman","UT"],["bountiful","UT"],
  // Vermont
  ["burlington","VT"],["south burlington","VT"],["montpelier","VT"],
  ["rutland","VT"],["barre","VT"],["winooski","VT"],
  ["st. johnsbury","VT"],["bennington","VT"],
  // Virginia
  ["virginia beach","VA"],["norfolk","VA"],["chesapeake","VA"],
  ["richmond","VA"],["newport news","VA"],["alexandria","VA"],
  ["hampton","VA"],["roanoke","VA"],["portsmouth","VA"],
  ["suffolk","VA"],["lynchburg","VA"],["harrisonburg","VA"],
  ["charlottesville","VA"],["manassas","VA"],["leesburg","VA"],
  ["blacksburg","VA"],["danville","VA"],["sterling","VA"],
  ["fredericksburg","VA"],["centreville","VA"],["herndon","VA"],
  ["woodbridge","VA"],["reston","VA"],
  // Washington
  ["seattle","WA"],["spokane","WA"],["tacoma","WA"],["vancouver","WA"],
  ["bellevue","WA"],["kent","WA"],["everett","WA"],["renton","WA"],
  ["spokane valley","WA"],["kirkland","WA"],["bellingham","WA"],
  ["kennewick","WA"],["yakima","WA"],["federal way","WA"],
  ["redmond","WA"],["marysville","WA"],["pasco","WA"],
  ["richland","WA"],["shoreline","WA"],["lacey","WA"],
  ["sammamish","WA"],["burien","WA"],["olympia","WA"],
  ["lakewood","WA"],["auburn","WA"],
  // West Virginia
  ["charleston","WV"],["huntington","WV"],["morgantown","WV"],
  ["parkersburg","WV"],["wheeling","WV"],["weirton","WV"],
  ["fairmont","WV"],["martinsburg","WV"],["beckley","WV"],
  // Wisconsin
  ["milwaukee","WI"],["madison","WI"],["green bay","WI"],
  ["kenosha","WI"],["racine","WI"],["appleton","WI"],
  ["waukesha","WI"],["oshkosh","WI"],["eau claire","WI"],
  ["janesville","WI"],["west allis","WI"],["la crosse","WI"],
  ["sheboygan","WI"],["wauwatosa","WI"],["fond du lac","WI"],
  ["new berlin","WI"],["wausau","WI"],["brookfield","WI"],
  ["beloit","WI"],["greenfield","WI"],
  // Wyoming
  ["cheyenne","WY"],["casper","WY"],["laramie","WY"],
  ["gillette","WY"],["rock springs","WY"],["sheridan","WY"],
  ["green river","WY"],["evanston","WY"],["riverton","WY"],
];

/**
 * Returns an array of unique state codes that match the given city input.
 * Exact match wins over prefix; returns [] if nothing matches.
 */
function getStatesForCity(cityValue: string): string[] {
  const key = cityValue.trim().toLowerCase();
  if (!key) return [];
  const exact = CITY_STATE_LIST.filter(([c]) => c === key).map(([, s]) => s);
  if (exact.length > 0) return [...new Set(exact)];
  const prefix = CITY_STATE_LIST.filter(([c]) => c.startsWith(key)).map(([, s]) => s);
  return [...new Set(prefix)];
}

interface Props {
  onSearch:      (filters: TrialSearchFilters) => void;
  loading?:      boolean;
  compact?:      boolean;
  initialValues: TrialSearchFilters;
}

export default function SearchForm({
  onSearch,
  loading = false,
  compact = false,
  initialValues,
}: Props) {
  const [condition, setCondition] = useState(initialValues.condition);
  const [city,      setCity]      = useState(initialValues.city);
  const [state,     setState_]    = useState(initialValues.state);
  const [status,    setStatus]    = useState(initialValues.status);
  const [phase,     setPhase]     = useState(initialValues.phase);
  const [validationError, setValidationError] = useState<string | null>(null);

  const userChoseState = useRef(false);

  useEffect(() => {
    setCondition(initialValues.condition);
    setCity(initialValues.city);
    setState_(initialValues.state);
    setStatus(initialValues.status);
    setPhase(initialValues.phase);
    userChoseState.current = false;
  }, [
    initialValues.condition, initialValues.city, initialValues.state,
    initialValues.status, initialValues.phase,
  ]);

  // Derived: which state codes match the current city text
  const matchedStateCodes = useMemo(() => getStatesForCity(city), [city]);

  /**
   * State dropdown options:
   *  - If city matches 1+ states: show only those + blank prompt
   *  - Otherwise: show all 50 states + blank prompt
   * Format: "Texas (TX)"
   */
  const stateOptions = useMemo(() => {
    const blank = { code: "", label: "Select State" };
    const pool = matchedStateCodes.length > 0
      ? matchedStateCodes.map((code) => ({ code, label: `${STATE_CODE_TO_LABEL[code]} (${code})` }))
      : US_STATES.map((s) => ({ code: s.code, label: `${s.label} (${s.code})` }));
    return [blank, ...pool];
  }, [matchedStateCodes]);

  // Auto-select state when city is typed
  const handleCityChange = useCallback((value: string) => {
    setCity(value);
    if (!userChoseState.current) {
      const matches = getStatesForCity(value);
      // Only auto-select when exactly 1 match; otherwise clear so user picks
      setState_(matches.length === 1 ? matches[0] : "");
    }
  }, []);

  const handleStateChange = useCallback((value: string) => {
    setState_(value);
    userChoseState.current = true;
  }, []);

  // Reset flag + state when city is fully cleared
  useEffect(() => {
    if (!city.trim()) {
      userChoseState.current = false;
      setState_("");
    }
  }, [city]);

  const handleSubmit = useCallback(async () => {
    if (!condition.trim()) return;
    const validation = await validateCityStateAsync(city, state);
    if (!validation.isValid) {
      setValidationError(validation.error || "Invalid city/state combination");
      setTimeout(() => setValidationError(null), 5000);
      return;
    }
    setValidationError(null);
    onSearch({ condition, city, state, status, phase });
  }, [condition, city, state, status, phase, onSearch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => { if (e.key === "Enter") handleSubmit(); },
    [handleSubmit],
  );

  const btnDisabled = loading || !condition.trim();

  const isFiltered   = matchedStateCodes.length > 0;
  const isAutoSingle = isFiltered && matchedStateCodes.length === 1 && !userChoseState.current;
  const isAmbiguous  = isFiltered && matchedStateCodes.length > 1;

  // ── COMPACT ──────────────────────────────────────────────────────────────────
  if (compact) {
    return (
      <>
        <style>{`
          .sf-compact {
            display: flex; gap: 8px; align-items: center;
            width: 100%; flex-wrap: nowrap; min-width: 0;
          }
          .sf-compact-input {
            height: 38px; padding: 0 14px;
            border: 1px solid var(--border); border-radius: var(--radius-md);
            font-size: 13px; color: var(--ink); background: var(--surface);
            outline: none; font-family: var(--font-sans);
            transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
            min-width: 0;
          }
          .sf-compact-input:focus {
            border-color: var(--blue-500);
            box-shadow: 0 0 0 3px rgba(16,185,129,0.12);
            background: #fff;
          }
          .sf-compact-input::placeholder { color: var(--muted-light); }
          .sf-compact-select {
            height: 38px; padding: 0 8px;
            border: 1px solid var(--border); border-radius: var(--radius-md);
            font-size: 13px; color: var(--ink); background: var(--surface);
            outline: none; cursor: pointer; font-family: var(--font-sans);
            transition: border-color 0.15s, background 0.15s;
          }
          .sf-compact-select:focus { border-color: var(--blue-500); }
          .sf-compact-select.auto  { border-color: var(--blue-400); background: var(--blue-50); }
          .sf-compact-select.multi { border-color: #f59e0b; background: #fffbeb; }
          .sf-compact-btn {
            height: 38px; padding: 0 18px;
            display: flex; align-items: center; gap: 7px;
            border: none; border-radius: var(--radius-md);
            font-size: 13px; font-weight: 600; color: #fff;
            cursor: pointer; font-family: var(--font-sans);
            white-space: nowrap; flex-shrink: 0;
            transition: all 0.16s cubic-bezier(.22,1,.36,1);
          }
          .sf-compact-btn:not(:disabled):hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(37,99,235,0.35);
          }
          .sf-compact-btn:disabled { cursor: not-allowed; }
        `}</style>
        <div className="sf-compact">
          <input
            className="sf-compact-input"
            style={{ flex: "2 1 0", minWidth: 120 }}
            placeholder="Condition or keyword"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Condition"
          />
          <input
            className="sf-compact-input"
            style={{ flex: "1 1 0", minWidth: 80 }}
            placeholder="City"
            value={city}
            onChange={(e) => handleCityChange(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="City"
          />
          <select
            className={`sf-compact-select${isAutoSingle ? " auto" : isAmbiguous ? " multi" : ""}`}
            style={{ flex: "1 1 0", minWidth: 180 }}
            value={state}
            onChange={(e) => handleStateChange(e.target.value)}
            aria-label="State"
          >
            {stateOptions.map((s) => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
          <select
            className="sf-compact-select"
            style={{ flex: "1 1 0", minWidth: 110 }}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Status"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s || "Any Status"}</option>)}
          </select>
          <button
            onClick={handleSubmit}
            disabled={btnDisabled}
            className="sf-compact-btn"
            style={{ background: btnDisabled ? "var(--muted-light)" : "var(--blue-600)" }}
          >
            {loading ? (
              <span style={{
                width: 14, height: 14, border: "2px solid rgba(255,255,255,0.35)",
                borderTopColor: "#fff", borderRadius: "50%",
                animation: "spinAnim 0.7s linear infinite", flexShrink: 0,
              }} />
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="6" cy="6" r="4.3" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            )}
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </>
    );
  }

  // ── HERO ──────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        .sf-hero-card {
          background: #fff;
          border-radius: 20px;
          border: 1px solid rgba(37,99,235,0.12);
          padding: 32px 36px 28px;
          box-shadow: 0 8px 40px rgba(37,99,235,0.12), 0 2px 8px rgba(37,99,235,0.06);
        }
        .sf-hero-eyebrow {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 16px;
        }
        .sf-hero-eyebrow-tag {
          font-size: 10px; font-weight: 700; color: var(--blue-600);
          text-transform: uppercase; letter-spacing: 1px;
          background: var(--blue-50); padding: 3px 10px;
          border-radius: 20px; border: 1px solid var(--blue-200);
        }
        .sf-hero-title {
          font-size: 30px; font-weight: 700; color: var(--ink);
          line-height: 1.2; margin-bottom: 24px; letter-spacing: -0.5px;
        }
        .sf-hero-title em { color: var(--blue-600); font-style: italic; }
        .sf-label {
          font-size: 10px; font-weight: 700; color: var(--muted);
          text-transform: uppercase; letter-spacing: 0.7px;
          margin-bottom: 7px; display: block;
        }
        .sf-label-hint {
          font-size: 9px; font-weight: 500;
          margin-left: 6px; font-style: italic;
          text-transform: none; letter-spacing: 0;
        }
        .sf-hero-input {
          height: 50px; padding: 0 18px;
          border: 1.5px solid var(--border); border-radius: var(--radius-lg);
          font-size: 15px; color: var(--ink); background: var(--surface);
          outline: none; font-family: var(--font-sans); width: 100%;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
        }
        .sf-hero-input:focus {
          border-color: var(--blue-500);
          box-shadow: 0 0 0 4px rgba(16,185,129,0.12);
          background: #fff;
        }
        .sf-hero-input::placeholder { color: var(--muted-light); }
        .sf-hero-select {
          height: 44px; padding: 0 14px;
          border: 1.5px solid var(--border); border-radius: var(--radius-lg);
          font-size: 13px; color: var(--ink); background: var(--surface);
          outline: none; cursor: pointer; font-family: var(--font-sans); width: 100%;
          transition: border-color 0.15s, background 0.15s;
        }
        .sf-hero-select:focus { border-color: var(--blue-500); }
        /* Single-match auto-selected */
        .sf-hero-select.auto-selected {
          border-color: var(--blue-400);
          background: var(--blue-50);
        }
        /* Multiple-match: user must choose */
        .sf-hero-select.ambiguous {
          border-color: #f59e0b;
          background: #fffbeb;
        }
        .sf-hero-btn {
          width: 100%; height: 54px;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          background: var(--blue-600); color: #fff;
          border: none; border-radius: var(--radius-lg);
          font-size: 16px; font-weight: 700; cursor: pointer;
          font-family: var(--font-sans);
          transition: all 0.18s cubic-bezier(.22,1,.36,1);
          letter-spacing: 0.2px;
          box-shadow: 0 4px 16px rgba(37,99,235,0.35);
        }
        .sf-hero-btn:hover:not(:disabled) {
          background: var(--blue-700);
          box-shadow: 0 8px 28px rgba(37,99,235,0.45);
          transform: translateY(-2px);
        }
        .sf-hero-btn:disabled {
          background: var(--muted-light); cursor: not-allowed;
          box-shadow: none; transform: none;
        }
        .sf-hint {
          font-size: 11px; color: var(--muted-light);
          margin-top: 5px; font-style: italic;
        }
        .sf-state-badge {
          font-size: 11px; margin-top: 5px; font-style: italic;
        }
        .sf-error-popup {
          position: fixed; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          z-index: 9999; padding: 28px 36px;
          background: #fff; border: 2px solid var(--coral-600);
          border-radius: var(--radius-xl);
          box-shadow: 0 24px 60px rgba(0,0,0,0.22);
          display: flex; flex-direction: column;
          align-items: center; gap: 14px;
          max-width: 420px; text-align: center;
          animation: fadeUp 0.2s ease both;
        }
        .sf-error-popup-icon { font-size: 36px; }
        .sf-error-popup-title { font-size: 17px; font-weight: 700; color: var(--ink); }
        .sf-error-popup-msg { font-size: 13px; color: var(--muted); line-height: 1.6; }
        .sf-error-popup-btn {
          padding: 9px 28px; background: var(--coral-600); color: #fff;
          border: none; border-radius: var(--radius-md);
          font-size: 14px; font-weight: 600; cursor: pointer;
          font-family: var(--font-sans); margin-top: 4px;
          transition: background 0.15s;
        }
        .sf-error-popup-btn:hover { background: #b91c1c; }
      `}</style>

      {validationError && (
        <div className="sf-error-popup">
          <div className="sf-error-popup-icon">⚠️</div>
          <div className="sf-error-popup-title">Invalid City / State</div>
          <div className="sf-error-popup-msg">{validationError}</div>
          <button className="sf-error-popup-btn" onClick={() => setValidationError(null)}>
            OK, I'll fix it
          </button>
        </div>
      )}

      <div className="sf-hero-card">
        <div className="sf-hero-eyebrow">
          <span className="sf-hero-eyebrow-tag">ClinicalTrials.gov</span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 11, fontWeight: 600, color: "#16a34a",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "var(--blue-500)", display: "inline-block",
            }} />
            Live database
          </span>
        </div>

        <h2 className="sf-hero-title">
          Find a <em>clinical trial</em> near you
        </h2>

        {/* Condition */}
        <div style={{ marginBottom: 16 }}>
          <label className="sf-label">
            Condition / Disease
            <span style={{ color: "var(--coral-600)", marginLeft: 3 }}>*</span>
          </label>
          <input
            className="sf-hero-input"
            placeholder="e.g. Breast Cancer, Type 2 Diabetes, Alzheimer's…"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          {!condition.trim() && (
            <div className="sf-hint">Required — enter a condition or keyword to search</div>
          )}
        </div>

        {/* Filters row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 22 }}>

          {/* City */}
          <div>
            <label className="sf-label">City</label>
            <input
              className="sf-hero-input"
              style={{ height: 44, fontSize: 13 }}
              placeholder="e.g. Boston"
              value={city}
              onChange={(e) => handleCityChange(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          {/* State — smart filtered dropdown */}
          <div>
            <label className="sf-label">
              State
              {isAutoSingle && (
                <span className="sf-label-hint" style={{ color: "var(--blue-500)" }}>
                  ✓ auto-filled
                </span>
              )}
              {isAmbiguous && (
                <span className="sf-label-hint" style={{ color: "#b45309" }}>
                  ⚠ {matchedStateCodes.length} matches — pick one
                </span>
              )}
            </label>
            <select
              className={[
                "sf-hero-select",
                isAutoSingle ? "auto-selected" : "",
                isAmbiguous  ? "ambiguous"    : "",
              ].filter(Boolean).join(" ")}
              value={state}
              onChange={(e) => handleStateChange(e.target.value)}
            >
              {stateOptions.map((s) => (
                <option key={s.code} value={s.code}>{s.label}</option>
              ))}
            </select>
            {isAutoSingle && (
              <div className="sf-state-badge" style={{ color: "var(--blue-500)" }}>
                State auto-filled from city
              </div>
            )}
            {isAmbiguous && !state && (
              <div className="sf-state-badge" style={{ color: "#b45309" }}>
                "{city}" exists in multiple states
              </div>
            )}
          </div>

          {/* Phase */}
          <div>
            <label className="sf-label">Phase</label>
            <select className="sf-hero-select" value={phase} onChange={(e) => setPhase(e.target.value)}>
              {PHASES.map((p) => <option key={p} value={p}>{p || "Any Phase"}</option>)}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="sf-label">Status</label>
            <select className="sf-hero-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s || "Any Status"}</option>)}
            </select>
          </div>
        </div>

        {/* Submit */}
        <button className="sf-hero-btn" onClick={handleSubmit} disabled={btnDisabled}>
          {loading ? (
            <>
              <span style={{
                width: 18, height: 18,
                border: "2.5px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff", borderRadius: "50%",
                animation: "spinAnim 0.7s linear infinite",
              }} />
              Searching…
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
                <circle cx="6" cy="6" r="4.3" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              Search Trials
            </>
          )}
        </button>
      </div>
    </>
  );
}