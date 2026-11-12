// Kenyan administrative reference data used by school-profile and setup forms.
// 47 counties; sub-counties follow the HDX "Kenya Sub Counties" layer
// (American Red Cross, CC BY) as distributed by davidamunga/kenya-locations.
// Schools can always enter a sub-county that is not listed ("Other").

export interface KenyaCounty {
  name: string;
  subCounties: string[];
}

export const KENYA_COUNTIES: KenyaCounty[] = [
  { name: "Mombasa", subCounties: ["Changamwe", "Jomvu", "Kisauni", "Likoni", "Mvita", "Nyali"] },
  { name: "Kwale", subCounties: ["Kinango", "Lunga Lunga", "Matuga", "Msambweni"] },
  { name: "Kilifi", subCounties: ["Ganze", "Kaloleni", "Kilifi North", "Kilifi South", "Magarini", "Malindi", "Rabai"] },
  { name: "Tana River", subCounties: ["Bura", "Galole", "Garsen"] },
  { name: "Lamu", subCounties: ["Lamu East", "Lamu West"] },
  { name: "Taita-Taveta", subCounties: ["Mwatate", "Taveta", "Voi", "Wundanyi"] },
  { name: "Garissa", subCounties: ["Balambala", "Dadaab", "Fafi", "Garissa", "Hulugho", "Ijara", "Lagdera"] },
  { name: "Wajir", subCounties: ["Eldas", "Tarbaj", "Wajir East", "Wajir North", "Wajir South", "Wajir West"] },
  { name: "Mandera", subCounties: ["Banissa", "Kutulo", "Lafey", "Mandera East", "Mandera North", "Mandera South", "Mandera West"] },
  { name: "Marsabit", subCounties: ["Laisamis", "Moyale", "North Horr", "Saku"] },
  { name: "Isiolo", subCounties: ["Garbatulla", "Isiolo", "Merti"] },
  { name: "Meru", subCounties: ["Buuri", "Igembe Central", "Igembe North", "Igembe South", "Imenti Central", "Imenti North", "Imenti South", "Tigania East", "Tigania West"] },
  { name: "Tharaka-Nithi", subCounties: ["Chuka", "Igambang'ombe", "Muthambi", "Mwimbi", "Tharaka North", "Tharaka South"] },
  { name: "Embu", subCounties: ["Manyatta", "Mbeere North", "Mbeere South", "Runyenjes"] },
  { name: "Kitui", subCounties: ["Kitui Central", "Kitui East", "Kitui Rural", "Kitui South", "Kitui West", "Mwingi Central", "Mwingi North", "Mwingi West"] },
  { name: "Machakos", subCounties: ["Athi River", "Kangundo", "Kathiani", "Machakos", "Masinga", "Matungulu", "Mwala", "Yatta"] },
  { name: "Makueni", subCounties: ["Kaiti", "Kibwezi East", "Kibwezi West", "Kilome", "Makueni", "Mbooni"] },
  { name: "Nyandarua", subCounties: ["Kinangop", "Kipipiri", "Ndaragwa", "Oljoroorok", "Olkalou"] },
  { name: "Nyeri", subCounties: ["Kieni East", "Kieni West", "Mathira East", "Mathira West", "Mukurweini", "Nyeri Central", "Nyeri South", "Tetu"] },
  { name: "Kirinyaga", subCounties: ["Kirinyaga Central", "Kirinyaga East", "Kirinyaga North/Mwea West", "Kirinyaga South", "Kirinyaga West"] },
  { name: "Murang'a", subCounties: ["Gatanga", "Kandara", "Kangema", "Kigumo", "Kiharu", "Mathioya", "Muranga South"] },
  { name: "Kiambu", subCounties: ["Gatundu North", "Gatundu South", "Githunguri", "Juja", "Kabete", "Kiambaa", "Kiambu Town", "Kikuyu", "Lari", "Limuru", "Ruiru", "Thika Town"] },
  { name: "Turkana", subCounties: ["Kibish", "Loima", "Turkana Central", "Turkana East", "Turkana North", "Turkana South", "Turkana West"] },
  { name: "West Pokot", subCounties: ["Pokot Central", "Pokot North", "Pokot South", "West Pokot"] },
  { name: "Samburu", subCounties: ["Samburu Central", "Samburu East", "Samburu North"] },
  { name: "Trans Nzoia", subCounties: ["Cherangany", "Endebess", "Kiminini", "Kwanza", "Saboti"] },
  { name: "Uasin Gishu", subCounties: ["Ainabkoi", "Kapseret", "Kesses", "Moiben", "Soy", "Turbo"] },
  { name: "Elgeyo-Marakwet", subCounties: ["Keiyo North", "Keiyo South", "Marakwet East", "Marakwet West"] },
  { name: "Nandi", subCounties: ["Aldai", "Chesumei", "Emgwen", "Mosop", "Nandi East", "Tinderet"] },
  { name: "Baringo", subCounties: ["Baringo Central", "Baringo North", "East Pokot", "Koibatek", "Marigat", "Mogotio"] },
  { name: "Laikipia", subCounties: ["Laikipia East", "Laikipia North", "Laikipia West"] },
  { name: "Nakuru", subCounties: ["Gilgil", "Kuresoi North", "Kuresoi South", "Molo", "Naivasha", "Nakuru East", "Nakuru North", "Nakuru West", "Njoro", "Rongai", "Subukia"] },
  { name: "Narok", subCounties: ["Narok East", "Narok North", "Narok South", "Narok West", "Transmara East", "Transmara West"] },
  { name: "Kajiado", subCounties: ["Kajiado Central", "Kajiado East", "Kajiado North", "Kajiado West", "Loitokitok"] },
  { name: "Kericho", subCounties: ["Ainamoi", "Belgut", "Bureti", "Kipkelion East", "Kipkelion West", "Sigowet/Soin"] },
  { name: "Bomet", subCounties: ["Bomet Central", "Bomet East", "Chepalungu", "Konoin", "Sotik"] },
  { name: "Kakamega", subCounties: ["Butere", "Ikolomani", "Khwisero", "Likuyani", "Lugari", "Lurambi", "Malava", "Matungu", "Mumias East", "Mumias West", "Navakholo", "Shinyalu"] },
  { name: "Vihiga", subCounties: ["Emuhaya", "Hamisi", "Luanda", "Sabatia", "Vihiga"] },
  { name: "Bungoma", subCounties: ["Bumula", "Cheptais", "Kabuchai", "Kanduyi", "Kimilili", "Mt Elgon", "Sirisia", "Tongaren", "Webuye East", "Webuye West"] },
  { name: "Busia", subCounties: ["Bunyala", "Butula", "Matayos", "Nambale", "Samia", "Teso North", "Teso South"] },
  { name: "Siaya", subCounties: ["Alego Usonga", "Bondo", "Gem", "Rarieda", "Ugenya", "Ugunja"] },
  { name: "Kisumu", subCounties: ["Kisumu Central", "Kisumu East", "Kisumu West", "Muhoroni", "Nyakach", "Nyando", "Seme"] },
  { name: "Homa Bay", subCounties: ["Homa Bay Town", "Kabondo Kasipul", "Karachuonyo", "Kasipul", "Mbita", "Ndhiwa", "Rangwe", "Suba"] },
  { name: "Migori", subCounties: ["Awendo", "Kuria East", "Kuria West", "Nyatike", "Rongo", "Suna East", "Suna West", "Uriri"] },
  { name: "Kisii", subCounties: ["Bobasi", "Bomachoge Borabu", "Bomachoge Chache", "Bonchari", "Kitutu Chache North", "Kitutu Chache South", "Nyaribari Chache", "Nyaribari Masaba", "South Mugirango"] },
  { name: "Nyamira", subCounties: ["Borabu", "Manga", "Masaba North", "Nyamira", "Nyamira North"] },
  { name: "Nairobi", subCounties: ["Dagoretti North", "Dagoretti South", "Embakasi Central", "Embakasi East", "Embakasi North", "Embakasi South", "Embakasi West", "Kamukunji", "Kasarani", "Kibra", "Langata", "Makadara", "Mathare", "Roysambu", "Ruaraka", "Starehe", "Westlands"] },
];

export const KENYA_COUNTY_NAMES = KENYA_COUNTIES.map((county) => county.name);

export function subCountiesFor(county: string | null | undefined): string[] {
  return KENYA_COUNTIES.find((entry) => entry.name === county)?.subCounties ?? [];
}
