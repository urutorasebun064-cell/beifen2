import { CITIES, STATION_ALIASES, toJa, toZh } from "@/lib/i18n";
import { hanFold } from "@/lib/han";
import { HUBS } from "@/data/hubs";

const KANA: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", を: "o", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ゃ: "ya", ゅ: "yu", ょ: "yo", っ: "tsu", ゎ: "wa",
  ー: "", ヵ: "ka", ヶ: "ga",
};

const DIGRAPHS: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
};

const YOMI: Record<string, string> = {};
function loadYomi(pack: string) {
  for (const part of pack.split(" ")) {
    const i = part.search(/[a-z]/);
    if (i <= 0) continue;
    YOMI[part.slice(0, i)] = part.slice(i);
  }
}

loadYomi(
  "田ta,da 前mae 川kawa,gawa 大o,dai,oo 山yama 野no 町machi 西nishi 新shin 中naka 東higashi,to 原hara,wara 上kami,ue 島shima,jima 小ko,o 高taka 津tsu 南minami 口kuchi,guchi 園sono,en 井i 北kita 三san,mi 橋hashi,bashi 木ki 本hon,moto 市shi,ichi 下shimo,shita 宮miya 谷tani,ya 松matsu 崎saki 寺tera,dera,ji 伊i 沢sawa,zawa 日hi,nichi 浜hama 神kami,jin 和wa,kazu 岡oka 江e 泉izumi 公ko 石ishi 長naga,cho 戸to,he 屋ya 八hachi,ya 内uchi 浦ura 水mizu,sui 平hira,taira 台dai 久hisa,ku 越koshi,etsu 目me 河kawa,gawa 瀬se 城shiro,jo 場ba,jo 佐sa 里sato 子ko,shi 後go,ushi 学gaku 岩iwa 見mi 羽ha,hane 生iki,o,nama 富tomi,to 尾o 海umi,kai 千chi,sen 吉yoshi,kichi 美mi 通tori,dori 福fuku 丁cho 京kyo,kei 部be,bu 坂saka,zaka 塚tsuka 豊toyo 安yasu 白shiro 二ni,fu 武take,mu 金kane,kin 温on 郷go,sato 森mori 地chi,ji 天ten,ama 賀ga,ka 古ko,furu 道michi,do 倉kura 国kuni 多ta 代dai,yo 波nami,ha 立tachi,ritsu 間ma,aida 名na,mei 一ichi,hito 馬uma,ma 陸riku,mutsu 御mi,go 根ne 土do,tsuchi 丘oka 赤aka 沼numa 鉄tetsu 阿a 条jo 所sho 広hiro 五go 鹿shika,ka 出de 成nari 村mura 門mon,kado 港minato 志shi 花hana 保ho,tamotsu 館kan,tate 院in 池ike 宇u 都to,miyako 王o 加ka 須su 船funa,fune 湯yu 蔵kura,zo 青ao 四shi,yo 鳥tori 横yoko 太ta,futo 宿juku,shuku 央o 滝taki 矢ya 十ju,to 手te 知chi 塩shio 丸maru 鶴tsuru 清kiyo,sei 幡hata,hata 岸kishi 明aki,mei 今ima 藤fuji,to 稲ine,ina 向mukai 校ko 別betsu 黒kuro 府fu 路ji,ro 阪saka,han 関seki 庄sho 永naga,ei 総so 良ra,yoshi 辺be,hen 駅eki 堀hori 相ai,sagami 比hi 会kai,e 備bi 林hayashi,rin 荒ara 六roku 飯ii,meshi 葉ha,ba 紀ki 光hikari,mitsu 社sha,yashiro 米kome,bei 有ari,yu 近chika,kon 方kata 合ai,go 勢se,sei 奥oku 濃no 桜sakura 居i 渡wata,do 布fu,nuno 甲ko 玉tama 予yo 月tsuki,getsu 柳yanagi 徳toku 竹take 入iri 電den 那na 奈na 梅ume 住sumi 之no 州shu,su 深fuka 茶cha 摩ma 畑hata 香ka,kaori 家ie,ya 牛ushi 春haru 信shin 茂shige 早haya 勝katsu 分bun,wake 曽so 七nana,shichi 役yaku 能no 栗kuri 治ji,haru 草kusa 朝asa 楽raku 肥hi 陽yo 動do 元moto 堂do 空sora,ku 熊kuma 筑chiku 笠kasa 岐gi 仁ni,jin 雲kumo 尻shiri 病byo 士shi 駒koma 板ita 常tsune,jo 柏kashiwa 九kyu,ku 湖ko 若waka 来ku,rai 郡gun 亀kame 愛ai 舞mai 作saku 喜ki,yoroko 桑kuwa 真ma,sana 旭asahi 杉sugi 守mori 万man,yorozu 留ru,tome 敷shiki 丹tan,ni 幌horo 洲su 磨ma 頭kashira,to 宝takara 片kata 竜ryu 形kata 輪wa 登to,nobo 浅asa 唐to 急kyu 師shi 芦ashi 舟fune 文fumi,bun 張hari,cho 軽karu 芸gei 行yuki,ko,iku 遠to,en 善zen 萩hagi 工ko 牧maki 取tori 磯iso 袋fukuro 砂suna 折ori 足ashi 巣su 品shina,hin 緑midori 湊minato 切kiri 端hashi,hana 俣mata 毛ke,mo 飛tobi,hi 音oto,ne 児ko,ji 魚uo,sakana 蒲kaba,gama 芝shiba 寒kan,samu 笹sasa 岳take,dake 延nobu 柴shiba 仙sen 由yoshi,yu 幸sachi,yuki 麻asa,ma 人hito,to 磐iwa 庫ko 潟gata 妙myo 室muro 巻maki 釜kama 鎌kama 鴨kamo 気ki 座za 恵e,megumi 落ochi 鳴nari 穂ho 街machi,gai 峰mine 豆mame,zu 鷹taka 蓮hasu 荘so 郎ro 角kado,kaku 我ga,wa 鵜u 植ue 殿tono,dono 姫hime 並nami 老oi 篠shino 細hoso 科shina 星hoshi 寄yose 狭saya,sa 荷ni,ka 栄sakae 県ken 網ami 狩kari 呂ro 医i 積seki 女onna,me,jo 団dan 渕fuchi 瑞mizu 厚atsu 百hyaku,momo 鈴suzu 区ku 垣kaki 犬inu 物mono 車kuruma,sha 穴ana 重shige,ju 伏fushi 利toshi,ri 粟awa 溝mizo 周shu 琴koto 発hatsu 秋aki 庭niwa 淵fuchi 境sakai 不fu 満mitsu,man 油abura 静shizu 当to 育iku 円en 込komi 開kai,hiraki 銀gin 蘭ran 斐hi,i 流nagare,ru 妻tsuma 桃momo 菅suga 貴taka,ki 業gyo 築chiku 観kan 羅ra 自ji 箕mi 酒sake 吹fuki 桂katsura 法ho 歳toshi 浪nami 軒noki 綾aya 弥ya,wata 鬼oni,ki 串kushi 与yo 母haha,mo 椎shii 騨da,hida 昭aki,sho 牟mu 世se,yo 貝kai 嵐arashi 糸ito 辻tsuji 滑name,sube 荻ogi 灘nada 第dai 播ban,hari 掛kake 諏su 訪ho,to 函hako 競kei 聖sei 熱netsu,atsu 用mochi,yo 智chi,tomo 心shin,kokoro 鷲washi 鼻hana 彦hiko 余yo,ama 遊yu,aso 礼rei 薬yaku 追oi 衣koromo,i 模mo 可ka 蘇so 洞hora,do 初hatsu,uibu 夜yo,yoru 葛kuzu,katsu 幕maku 札satsu,fuda 風kaze,fu 打uchi 讃san 峡kyo 直nao,choku 棚tana 薩satsu 隈kuma 免men,manuka 樽taru 際sai 番ban 陵ryo 洗arai 吾aga,ware 半han 貫kan 運un 霞kasumi 交ko 桟san 防bo,fuse 烏karasu 桐kiri 柿kaki 記ki 念nen 詰tsume 弘hiro 末sue,matsu 芳yoshi 養yo 坊bo 摂setsu 持mochi 淀yodo 博hiro 茅kaya,chi 呉kure,go 渋shibu 群gun 盛mori 左sa,hidari 堺sakai 渓tani,kei 隅sumi 箱hako 司shi 錦nishiki 乙otsu 面omo,men 窪kubo 坪tsubo 商sho 味aji,mi 農no 民min 術jutsu 線sen 体tai 鴻ko 刈kari 針hari 峠toge 字aza,ji 曲magari,kyoku 外soto,gai 脇waki 祇gi 納osame,no 興okoshi,kyo 房fusa,bo 歌uta,ka 栃tochi 添soe 参san,mai 引hiki 槻tsuki 潮shio 次tsugi,ji 造zo,tsukuri 洋yo 阜fu 枝eda 猪inoshishi,i 度do,tabi 影kage 帯obi,tai 孫mago 栖sumi,sei 梶kaji 領ryo 虎tora 臼usu 友tomo 嶺mine 押oshi 尼ama 景kei,kage 又mata 苗nae 正masa,sho 萱kaya 跡ato 舎sha 苅kari 実mi,jitsu 段dan 球tama,kyu 鯖saba 筋suji 華hana 杜mori 湘sho 仏hotoke,butsu 力chikara,riki 雀suzume 嘉ka,yoshi 床yuka,toko 盤ban 迫hako,sako 泊tomari 置oki 畠hatake 位i,kurai 陣jin 菊kiku 扇ogi 蟹kani 者sha,mono 織ori 櫛kushi 印in,shirushi 服fuku 茨ibara,bara 鶯uguisu 徒to 習narai 増masu 峨ga 柄gara,e 務mu 祝iwai 舌shita 教kyo 療ryo 秦hata 諸moro 伯haku 乃no 宍shishi 益eki,masu 黄ki,ko 鍋naba 反tan,so 干hoshi,kan 施shi 指yubi,shi 達tachi,tatsu 恋koi 珠tama 連ren,mure 咲saki 斗to 色iro 附tsuke,fu 垂tare 軍gun 両ryo 榎enoki 猿saru 梨nashi 杵kine 藪yabu 男otoko,nan 研ken 宗so,mune 紫murasaki 狛koma 堤tsutsumi 在zai 甘ama 時toki,ji 膳zen 庁cho 淡awa 修shu 荏e 曳hiki 仲naka 刀katana,to 調cho 枚mai 雑zatsu 汐shio 楠kusu 皆mina 極kiwami,goku 帝tei 事koto,ji 澄sumi 練neri 英ei,hide 岬misaki 妹imo 拝hai,ogamu 乗nori 計kei,hakari 童warabe,do 年toshi,nen 逗zu 束taba,soku 待machi 好kono,suki 更sara,ko 似ni 晴hare 柱hashira 階kai 身mi 椿tsubaki 検ken 止tome,shi 堅kata 祖so 緒o,sho 焼yaki 速haya 雄o 塔to 寿kotobuki,ju 浮uki 理ri 胡ko,ebisu 梁yani,ryo 父chichi,fu 儀gi 崇su,taka 苫toma 稚waka 沖oki 犀sai 迎mukae 兵hei,hyo 霧kiri 源minamoto,gen 結yui,ketsu 鳩hato 夕yu 呼yo,yobu 蛇hebi,ja 的teki,mato 駄da 弁ben 沓kutsu 難nan 鞍kura 種tane 財zai 縄nawa 枇bi 杷wa,ha 倍bai 鮎ayu 夏natsu 砥to 差sa,sashi 覚kaku,obo 氷kori 料ryo 同do,ona 忍shinobu 嵩kasane 燕tsubame 無mu,na 粉kona 願negai 滋shige,ji 資shi 希ki,mare 望mochi,bo 依i,yo 局kyoku 経kei,he 書sho,kaki 辛kara 菜na 健ken,takeru 鵠kigo,koku 蛍hotaru 虫mushi 伝tsute,den 申sarum,shin 鷺sagi 親oya,shin 曙akebono 議gi 苑sono,en 碧heki,ao 倶ku,tomo 伽ka 任nin,maka 因in,china 氏uji,shi 袖sode 撫nade 厄yaku 具gu 主shu,nushi 櫃hitsu 俵tawara 暮kure 弓yumi 塘to 斜nana,sha 藻mo 奴yakko,do 忠chuu,tada 駿shun,suruga 禅zen 婦fu 庶sho 姉ane 傍soba,bo 拓taku,hiraku 界kai 慈ji,itsuku 聞kiki 産san,ubu 楼ro 基moto,ki 集atsu,shu 冠kanmuri 着chaku,ki 柚yuzu 剣ken 問to,mon 兜kabuto 勇isa,yu 敦atsu 閑kan 続tsuzuki 双so,futatsu 逢ai 夙shuku,haya 瓜uri 額gaku,hitai 橘tachibana 食shoku,ku 嶽take,dake 涌waku 苦kuru,ku 麗urei,rei 銚cho 梓azusa 摺suri 厩umaya 壁kabe 綿wata 隆taka,ryu 桧hinoki 定sada,tei 辰tatsu 現gen,arawa 堰seki 股mata 刺sashi 箸hashi 歩ho,aru 危abu,ki 薙nagi 厨kuriya 鏡kagami 腰koshi 君kimi 畷nawate 払harai 銅do,akagane 桝masu 旧kyu 供tomo,ku 隼hayabusa 豪go 雨ame 稜ryo 郭kaku 桔kichi,kitsu 梗kyo 縫nui 夫otto,fu 然zen,shika 唄uta 鮫same 侍samurai 替kae 梯hashigo,tei 畔hotori,aze 要kaname,yo 表omote,hyo 典ten,nori 飼kai 藍ai 寝ne 判han,ban 釣tsuri 化ka,bake 権ken,gon 思omo,shi 旦tan,aki 振furi 毘bi 沙sa,suna 伴tomo,han 俊shun,toshi 埠fu 戦sen,ikusa 陶to,sue 挙kyo,aga 環kan,tama 管kan,kuda 宅taku,yashiki 助suke 創so,tsuku 絹kinu 給kyu,tama 霊rei,tama 址shi,ato 瓦kawara 染some 等nado,to 蚕kaiko 筒tsutsu 橿kashi 斎itsuki,sai 恩on 旗hata 菰koma,komo 鼓tsuzumi 点ten 紙kami 属zoku 協kyo 義gi,yoshi 鐘kane 逆gyaku,saka 売uri 図zu 衛e,mamoru 隊tai 季ki 飾kazari 夢yume 騎ki 才sai,waza 政masa,sei 秩chitsu 綱tsuna 官kan 破ha,yabu 割wari 剛go 怒iko,do 浄jo,kiyo 象zo,sho 唯tada,yui 漆urushi 乱ran 醍dai 醐go 鯉koi 沿soi 釈shaku 迦ka 机tsukue 帆ho 兄ani,kei 誉homare 冷hiya,rei 導michi,do 蕨warabi 臨rin,nozo 労ro,rogo 湿shime 標hyo,shirube 走hashi 馳hase 婆ba,baba 畳tatami 応o,kota 裾suso 雁gan,kari 桶oke 籠kago 昌masa,sho 渚nagisa 得toku,e 芽me 頃koro 章sho,akira 鳳hoo 終owari,shu 解kai,ge 玄gen,kuro 鎧yoroi 組kumi 猛take,mo 敬kei,uyama 特toku 腹hara 眼me,gan 枕makura 紋mon 稀mare,ki 杖tsue 進shin,susu 威i,odashi 檜hinoki 底soko 鯨kujira 耶ya 竪tate 祭matsuri 佳ka,yoshi 占ura,shi 緋hi 邑mura 照teru 祉shi 祥shou,yoshi 奇ki,kushiki 碁go 彼kare 只tada 虹niji 兼kane 麓fumoto 埼saki 建tate,ken 削kezu 誕tan,umare 佃tsukuda 繁shige 改aratame 厳kibi,gen 共tomo,kyo 求motome 幣hei,nusa 幅haba 貞sada,tei 採tori,sai 歓yoroko,kan 釘kugi 朽kuchi 餅mochi 帖cho,jo 銭zeni 背se,sei 槙maki 為tame,su 桁keta 翁okina 姥uba 例rei,tatoe 於o,okeru 楢nara 刑kei 討uchi,to 庵iori 放hana,ho 詫wabi 鎚tsuchi 丈take,jo 卯u 升masu 降ori,ko 域iki 轟todoroki 藩han 究kiwame,kyu 機hata,ki 貿bo 易yasu,eki 算san 磁ji 竈kamado 祈inori 露tsuyu,ro 卸oroshi 漢kan 警kei 察satsu 署sho 砲ho 遥haruka 堪tae,kan 談dan,kata 旅tabi 精sei,shira 踊odo 蒔maki 郵yu 便ben,bin 輝kagayaki 劇geki 言koto,gen 覇ha 禄roku 首kubi,shu 私watashi,shi 樟kusu 墨sumi 蹴ke 皮kawa 謝sha,ayama 麦mugi 屏hei,byo 逸hayu,itsu 尺shaku 賢kashiko,ken 耳mimi 榊sakaki 栽sai,u 但tada 孔ana,ko 慶kei,yoroko 再sai,futatabi 髪kami 縮chijimi 裁sai,saba 塾juku 洛raku 先saki,sen 杭kui 啓hiraku,kei 狸tanuki 状jo 暁akatsuki 員in 槌tsuchi 短mijika,tan 鶏niwatori 普fu,hiro 兎usagi 族zoku 射i,sha 涙namida 純jun 鉾hoko 騒sawa 笑warai 潜moguri,sen 血chi 粕kasu 旨mune,shi 樫kashi 菱hishi 嬉ureshi 航ko 是ze,kore 験ken 坑ko 狐kitsune 程hodo 接setsu,tsu 格kaku 抜nuki 少suko,sho 宜yoroshiku,gi 彩irodo,sai 汲kumi 苔koke 感kan 案an 寸sun 技waza 介suke,kai 陰kage,in 雪yuki 祐tasuke,yu 溜tame 護mamo,go 麹koji 巳mi,shi 展ten 示shimesu,ji 鉢hachi 戎ebisu 孝ko 畦aze 過su,ka 企kuwada,ki 救sukui 蚊ka 爪tsume 患wazur,kan 店mise 器utsuwa 顔kao 投nage 甚hanaha,jin 令rei 令rei",
);

const SPECIAL: Record<string, string> = {
  東京: "tokyo",
  東京タワー: "tokyotower",
  東京スカイツリー: "tokyoskytree",
  大阪: "osaka",
  京都: "kyoto",
  名古屋: "nagoya",
  新宿: "shinjuku",
  渋谷: "shibuya",
  池袋: "ikebukuro",
  横浜: "yokohama",
  川崎: "kawasaki",
  大宮: "omiya",
  千葉: "chiba",
  船橋: "funabashi",
  西船橋: "nishifunabashi",
  秋葉原: "akihabara",
  上野: "ueno",
  品川: "shinagawa",
  新橋: "shinbashi",
  有楽町: "yurakucho",
  東京テレポート: "tokyoteleport",
  御茶ノ水: "ochanomizu",
  お茶の水: "ochanomizu",
  神田: "kanda",
  日暮里: "nippori",
  西日暮里: "nishinippori",
  北千住: "kitasenju",
  南千住: "minamisenju",
  亀有: "kameari",
  金町: "kanamachi",
  松戸: "matsudo",
  柏: "kashiwa",
  我孫子: "abiko",
  取手: "toride",
  成田: "narita",
  成田空港: "naritaairport",
  羽田空港: "hanedaairport",
  羽田空港第1ターミナル: "hanedaterminal1",
  羽田空港第2ターミナル: "hanedaterminal2",
  羽田空港第3ターミナル: "hanedaterminal3",
  木場: "kiba",
  門前仲町: "monzennakacho",
  清澄白河: "kiyosumishirakawa",
  住吉: "sumiyoshi",
  錦糸町: "kinshicho",
  押上: "oshiage",
  浅草: "asakusa",
  浅草橋: "asakusabashi",
  蔵前: "kuramae",
  両国: "ryogoku",
  亀戸: "kameido",
  小岩: "koiwa",
  市川: "ichikawa",
  本八幡: "motoyawata",
  津田沼: "tsudanuma",
  幕張: "makuhari",
  幕張本郷: "makuharihongo",
  海浜幕張: "kaihinmakuhari",
  稲毛: "inage",
  西千葉: "nishichiba",
  蘇我: "soga",
  五井: "goi",
  木更津: "kisarazu",
  君津: "kimitsu",
  袖ケ浦: "sodegaura",
  袖ヶ浦: "sodegaura",
  南行徳: "minamigyotoku",
  行徳: "gyotoku",
  妙典: "myoden",
  原木中山: "barakinakayama",
  西葛西: "nishikasai",
  葛西: "kasai",
  浦安: "urayasu",
  舞浜: "maihama",
  新浦安: "shinurayasu",
  市川塩浜: "ichikawashiohama",
  二俣新町: "futamatashinmachi",
  南船橋: "minamifunabashi",
  新木場: "shinkiba",
  辰巳: "tatsumi",
  豊洲: "toyosu",
  月島: "tsukishima",
  勝どき: "kachidoki",
  築地: "tsukiji",
  東銀座: "higashiginza",
  銀座: "ginza",
  日本橋: "nihonbashi",
  三越前: "mitsukoshimae",
  大手町: "otemachi",
  霞ケ関: "kasumigaseki",
  霞ヶ関: "kasumigaseki",
  国会議事堂前: "kokkaigijidomae",
  溜池山王: "tameikesanno",
  赤坂: "akasaka",
  赤坂見附: "akasakamitsuke",
  永田町: "nagatacho",
  四ツ谷: "yotsuya",
  四谷: "yotsuya",
  市ケ谷: "ichigaya",
  市ヶ谷: "ichigaya",
  飯田橋: "iidabashi",
  水道橋: "suidobashi",
  後楽園: "korakuen",
  春日: "kasuga",
  本郷三丁目: "hongosanchome",
  東大前: "todaimae",
  根津: "nezu",
  千駄木: "sendagi",
  西ヶ原: "nishigahara",
  駒込: "komagome",
  田端: "tabata",
  巣鴨: "sugamo",
  大塚: "otsuka",
  目白: "mejiro",
  高田馬場: "takadanobaba",
  新大久保: "shinokubo",
  代々木: "yoyogi",
  原宿: "harajuku",
  恵比寿: "ebisu",
  目黒: "meguro",
  五反田: "gotanda",
  大崎: "osaki",
  田町: "tamachi",
  浜松町: "hamamatsucho",
  吉祥寺: "kichijoji",
  三鷹: "mitaka",
  武蔵境: "musashisakai",
  東小金井: "higashikoganei",
  武蔵小金井: "musashikoganei",
  国分寺: "kokubunji",
  国立: "kunitachi",
  立川: "tachikawa",
  日野: "hino",
  豊田: "toyota",
  八王子: "hachioji",
  西八王子: "nishihachioji",
  高尾: "takao",
  中野: "nakano",
  高円寺: "koenji",
  阿佐ケ谷: "asagaya",
  阿佐ヶ谷: "asagaya",
  荻窪: "ogikubo",
  西荻窪: "nishiogikubo",
  下北沢: "shimokitazawa",
  明大前: "meidaimae",
  下高井戸: "shmotakaido",
  桜上水: "sakurajosui",
  上北沢: "kamikitazawa",
  八幡山: "hachimanyama",
  芦花公園: "rokakoen",
  千歳烏山: "chitosekarasuyama",
  仙川: "sengawa",
  つつじヶ丘: "tsutsujigaoka",
  柴崎: "shibasaki",
  国領: "kokuryo",
  布田: "fuda",
  調布: "chofu",
  西調布: "nishichofu",
  飛田給: "tobitakyu",
  武蔵野台: "musashinodai",
  東府中: "higashifuchu",
  府中: "fuchu",
  分倍河原: "bubaigawara",
  中河原: "nakagawara",
  聖蹟桜ヶ丘: "seisekisakuragaoka",
  百草園: "mogusaen",
  高幡不動: "takahatafudo",
  南平: "minamidaira",
  平山城址公園: "hirayamajoshikoen",
  長沼: "naganuma",
  北野: "kitano",
  京王八王子: "keiobhachioji",
  京王永山: "keiobnagayama",
  京王多摩センター: "keiotamacenter",
  南大沢: "minamiosawa",
  橋本: "hashimoto",
  相模原: "sagamihara",
  町田: "machida",
  相模大野: "sagamiono",
  小田急相模原: "odakyuusagamihara",
  登戸: "noborito",
  向ヶ丘遊園: "mukogaokayuen",
  生田: "ikuta",
  読売ランド前: "yomiurilandmae",
  百合ヶ丘: "yurigoka",
  新百合ヶ丘: "shinyurigaoka",
  柿生: "kakio",
  鶴川: "tsurukawa",
  玉川学園前: "tamagawagakuenmae",
  成瀬: "naruse",
  長津田: "nagatsuta",
  中央林間: "chuorinkan",
  南町田グランベリーパーク: "minamimachida",
  つくば: "tsukuba",
  研究学園: "kenkyugakuen",
  万博記念公園: "banpakukinenkoen",
  柏の葉キャンパス: "kashiwanohacampus",
  流山おおたかの森: "nagareyamaotakanomori",
  流山セントラルパーク: "nagareyamacentralpark",
  南流山: "minaminagareyama",
  三郷中央: "misatochuo",
  八潮: "yashio",
  六町: "rokucho",
  青井: "aoi",
  北綾瀬: "kitaayase",
  綾瀬: "ayase",
  堀切: "horikiri",
  曳舟: "hikifune",
  業平橋: "narihirabashi",
  とうきょうスカイツリー: "tokyoskytree",
  野田市: "nodashi",
  野田: "noda",
  川間: "kawama",
  七光台: "nanakodai",
  清水公園: "shimizukoen",
  愛宕: "atago",
  運河: "unga",
  江戸川台: "edogawadai",
  初石: "hatsuishi",
  流山: "nagareyama",
  豊四季: "toyoshiki",
  新柏: "shinkashiwa",
  増尾: "masuo",
  逆井: "sakasai",
  高柳: "takayanagi",
  六実: "mutsumi",
  新鎌ヶ谷: "shinkamagaya",
  鎌ヶ谷: "kamagaya",
  馬込沢: "magomezawa",
  塚田: "tsukada",
  新船橋: "shinfunabashi",
  京成船橋: "keiseifunabashi",
  京成津田沼: "keiseitsudanuma",
  京成大久保: "keiseiokubo",
  実籾: "mimomi",
  八千代台: "yachiyodai",
  京成大和田: "keiseiowada",
  勝田台: "katsutadai",
  志津: "shizu",
  ユーカリが丘: "yukarigaoka",
  京成臼井: "keiseiusui",
  京成佐倉: "keiseisakura",
  大佐倉: "osakura",
  京成酒々井: "keiseishisui",
  宗吾参道: "sogosando",
  公津の杜: "kozunomori",
  京成成田: "keiseinarita",
  東成田: "higashinarita",
  成田湯川: "naritayukawa",
  印旛日本医大: "imbarihonidai",
  印西牧の原: "inzaimakinohara",
  千葉ニュータウン中央: "chibanewtownchuo",
  小室: "komuro",
  松飛台: "matsuhidai",
  大町: "omachi",
  北初富: "kitahatsutomi",
  二和向台: "futawamukodai",
  滝不動: "takifudo",
  修紅: "shuku",
  薬園台: "yakuendai",
  前原: "maeharu",
  三咲: "misaki",
  鎌ヶ谷大仏: "kamagayadaibutsu",
  初富: "hatsutomi",
  北習志野: "kitanarashino",
  船橋日大前: "funabashinichidaimae",
  飯山満: "hasama",
  東葉勝田台: "toyokatsutadai",
  村上: "murakami",
  八千代緑が丘: "yachiyomidorigaoka",
  八千代中央: "yachiyochuo",
  吉橋: "yoshihashi",
  千葉中央: "chibachuo",
  県庁前: "kenchomae",
  葭川公園: "yoshikawakoen",
  栄町: "sakaemachi",
  木下: "kioroshi",
  小林: "kobayashi",
  安食: "ajiki",
  下総松崎: "shimofusamazaki",
  久留里: "kururi",
  横芝: "yokoshiba",
  八街: "yachimata",
  榎戸: "enokido",
  物井: "monoi",
  佐倉: "sakura",
  南酒々井: "minamishisui",
  酒々井: "shisui",
  福岡: "fukuoka",
  博多: "hakata",
  天神: "tenjin",
  札幌: "sapporo",
  仙台: "sendai",
  広島: "hiroshima",
  神戸: "kobe",
  三ノ宮: "sannomiya",
  三宮: "sannomiya",
  元町: "motomachi",
  奈良: "nara",
  金沢: "kanazawa",
  長野: "nagano",
  新大阪: "shinosaka",
  梅田: "umeda",
  難波: "namba",
  なんば: "namba",
  心斎橋: "shinsaibashi",
  天王寺: "tennoji",
  鶴橋: "tsuruhashi",
  京橋: "kyobashi",
  淀屋橋: "yodoyabashi",
  本町: "hommachi",
  堺筋本町: "sakaisujihommachi",
  谷町四丁目: "tanimachiyonchome",
  東梅田: "higashiumeda",
  西梅田: "nishiumeda",
  中津: "nakatsu",
  十三: "juso",
  庄内: "shonai",
  岡町: "okamachi",
  豊中: "toyonaka",
  蛍池: "hotarugaike",
  石橋阪大前: "ishibashihakudaimae",
  池田: "ikeda",
  川西能勢口: "kawanishinoseguchi",
  雲雀丘花屋敷: "hibarigaokahanayashiki",
  宝塚: "takarazuka",
  西宮: "nishinomiya",
  西宮北口: "nishinomiyakitaguchi",
  夙川: "shukugawa",
  芦屋: "ashiya",
  岡本: "okamoto",
  御影: "mikage",
  六甲: "rokko",
  王子公園: "ojikoen",
  春日野道: "kasuganomichi",
  神戸三宮: "kobesannomiya",
  阪急神戸三宮: "hankyukobesannomiya",
  花隈: "hanakuma",
  高速神戸: "kosokukobe",
  新開地: "shinkaichi",
  湊川: "minatogawa",
  板宿: "itayado",
  須磨: "suma",
  垂水: "tarumi",
  舞子: "maiko",
  西代: "nishidai",
  東須磨: "higashisuma",
  月見山: "tsukimiyama",
  須磨浦公園: "sumaurakoen",
  大津: "otsu",
  膳所: "zeze",
  石山: "ishiyama",
  瀬田: "seta",
  南草津: "minamikussatsu",
  草津: "kusatsu",
  守山: "moriyama",
  野洲: "yasu",
  篠原: "shinohara",
  近江八幡: "omihachiman",
  能登川: "notogawa",
  安土: "azuchi",
  彦根: "hikone",
  米原: "maibara",
  岐阜: "gifu",
  岐阜羽島: "gifuhashima",
  尾張一宮: "owariichinomiya",
  金山: "kanayama",
  栄: "sakae",
  伏見: "fushimi",
  丸の内: "marunouchi",
  久屋大通: "hisayaodori",
  上前津: "kamimaezu",
  矢場町: "yabacho",
  日進: "nisshin",
  東岡崎: "higashiokazaki",
  豊橋: "toyohashi",
  浜松: "hamamatsu",
  静岡: "shizuoka",
  富士: "fuji",
  沼津: "numazu",
  三島: "mishima",
  熱海: "atami",
  小田原: "odawara",
  国府津: "kouzu",
  二宮: "ninomiya",
  大磯: "oiso",
  平塚: "hiratsuka",
  茅ケ崎: "chigasaki",
  茅ヶ崎: "chigasaki",
  辻堂: "tsujido",
  藤沢: "fujisawa",
  大船: "ofuna",
  戸塚: "totsuka",
  東戸塚: "higashitotsuka",
  保土ケ谷: "hodogaya",
  保土ヶ谷: "hodogaya",
  桜木町: "sakuragicho",
  関内: "kannai",
  石川町: "ishikawacho",
  山手: "yamate",
  根岸: "negishi",
  磯子: "isogo",
  新杉田: "shinsugita",
  洋光台: "yokodai",
  港南台: "konandai",
  本郷台: "hongodai",
  鎌倉: "kamakura",
  北鎌倉: "kitakamakura",
  横須賀: "yokosuka",
  逗子: "zushi",
  東逗子: "higashizushi",
  田浦: "taura",
  安針塚: "anjinzuka",
  逸見: "hemi",
  汐入: "shioiri",
  横須賀中央: "yokosukachuo",
  県立大学: "kenritsudaigaku",
  堀ノ内: "horinouchi",
  京急大津: "keikyuootsu",
  馬堀海岸: "makorigaigan",
  浦賀: "uraga",
  久里浜: "kurihama",
  三浦海岸: "miurakaigan",
  三崎口: "misakiguchi",
  上大岡: "kamiooka",
  上永谷: "kaminagaya",
  舞岡: "maioka",
  中山: "nakayama",
  十日市場: "tokaichiba",
  青葉台: "aobadai",
  藤が丘: "fujigaoka",
  市が尾: "ichigao",
  江田: "eda",
  あざみ野: "azamino",
  たまプラーザ: "tamaplaza",
  鷺沼: "saginuma",
  宮前平: "miyamaedaira",
  宮崎台: "miyazakidai",
  梶が谷: "kajigaya",
  溝の口: "mizonokuchi",
  武蔵溝ノ口: "musashimizonokuchi",
  武蔵小杉: "musashikosugi",
  新丸子: "shinmaruko",
  多摩川: "tamagawa",
  田園調布: "denenchofu",
  自由が丘: "jiyugaoka",
  都立大学: "toritsudaigaku",
  学芸大学: "gakugeidaigaku",
  祐天寺: "yutenji",
  中目黒: "nakameguro",
  代官山: "daikanyama",
  池尻大橋: "ikejiriohashi",
  三軒茶屋: "sangenjaya",
  駒沢大学: "komazawadaigaku",
  桜新町: "sakurashinmachi",
  用賀: "yoga",
  二子玉川: "futakotamagawa",
  二子新地: "futakoshinchi",
  高津: "takatsu",
  津田山: "tsudayama",
  久地: "kuji",
  宿河原: "shukugawara",
  和泉多摩川: "izumitamagawa",
  狛江: "komae",
  喜多見: "kitami",
  成城学園前: "seijogakuenmae",
  祖師ヶ谷大蔵: "soshigayaokura",
  千歳船橋: "chitosefunabashi",
  経堂: "kyodo",
  豪徳寺: "gotokuji",
  梅ヶ丘: "umegaoka",
  世田谷代田: "setagayadaita",
  東北沢: "higashikitazawa",
  代々木上原: "yoyogiuehara",
  代々木八幡: "yoyogihachiman",
  代々木公園: "yoyogikoen",
  明治神宮前: "meijijingumae",
  表参道: "omotesando",
  外苑前: "gaiemmae",
  青山一丁目: "aoyamaitchome",
  日比谷: "hibiya",
  宝町: "takaracho",
  水天宮前: "suitengumae",
  菊川: "kikukawa",
  森下: "morishita",
  東陽町: "toyocho",
  南砂町: "minamisunamachi",
  西大島: "nishiojima",
  大島: "ojima",
  東大島: "higashiojima",
  船堀: "funabori",
  一之江: "ichinoe",
  瑞江: "mizue",
  篠崎: "shinozaki",
};

function hira(ch: string) {
  const c = ch.charCodeAt(0);
  if (c >= 0x30a1 && c <= 0x30f6) return String.fromCharCode(c - 0x60);
  return ch;
}

function kanaRomaji(text: string) {
  let out = "";
  const s = [...text].map(hira).join("");
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (DIGRAPHS[two]) {
      out += DIGRAPHS[two];
      i++;
      continue;
    }
    const ch = s[i]!;
    if (ch === "っ" && i + 1 < s.length) {
      const next = kanaRomaji(s[i + 1]!)[0] ?? "t";
      out += next;
      continue;
    }
    if (ch === "ん") {
      const n = s[i + 1] ?? "";
      out += /[bmp]/i.test(kanaRomaji(n)[0] ?? "") ? "m" : "n";
      continue;
    }
    out += KANA[ch] ?? ch;
  }
  return out;
}

function kanjiYomi(ch: string) {
  return (YOMI[ch] ?? "").split(",").filter(Boolean);
}

function romanizeName(name: string) {
  const special = SPECIAL[name];
  const out = new Set<string>();
  if (special) out.add(special.replace(/\s+/g, ""));
  let primary = "";
  const altLast: string[] = [];
  for (const ch of name) {
    if (ch === "ヶ" || ch === "ケ") {
      primary += "ga";
      continue;
    }
    if (ch === "ノ" || ch === "之" || ch === "乃") {
      primary += "no";
      continue;
    }
    if (ch === "ヵ") {
      primary += "ka";
      continue;
    }
    if (ch === "ー" || ch === "・" || ch === " " || ch === "　") continue;
    const h = hira(ch);
    if (KANA[h] || DIGRAPHS[h] || h === "っ" || h === "ん") {
      primary += kanaRomaji(ch);
      continue;
    }
    const y = kanjiYomi(ch);
    if (y.length) {
      primary += y[0];
      if (y[1]) altLast.push(y[1]);
      else altLast.push(y[0]!);
    }
  }
  if (primary) out.add(primary);
  if (altLast.length) {
    const chars = [...name];
    let alt = "";
    let yi = 0;
    for (const ch of chars) {
      if (ch === "ヶ" || ch === "ケ") {
        alt += "ga";
        continue;
      }
      if (ch === "ノ" || ch === "之" || ch === "乃") {
        alt += "no";
        continue;
      }
      const h = hira(ch);
      if (KANA[h] || h === "っ" || h === "ん") {
        alt += kanaRomaji(ch);
        continue;
      }
      const y = kanjiYomi(ch);
      if (y.length) {
        const isLast = yi === altLast.length - 1;
        alt += isLast && y[1] ? y[1] : y[0];
        yi++;
      }
    }
    if (alt) out.add(alt);
  }
  return [...out];
}

export function foldKey(s: string) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[駅站]/g, "")
    .replace(/station$/i, "")
    .replace(/[-–—'’.\s_]/g, "")
    .trim();
}

export function stationSearchKeys(name: string) {
  const keys = new Set<string>();
  const add = (s: string) => {
    const f = foldKey(s);
    if (f) keys.add(f);
    const h = hanFold(s);
    if (h) keys.add(h);
  };
  add(name);
  add(toZh(name));
  add(toJa(name));
  for (const r of romanizeName(name)) add(r);
  const alias = STATION_ALIASES[name] ?? STATION_ALIASES[toZh(name)];
  if (alias) add(alias);
  for (const hub of HUBS) {
    if (hub.name === name) hub.aliases.forEach(add);
  }
  for (const city of CITIES) {
    if (city.ja === name) {
      add(city.zh);
      add(city.en);
    }
  }
  return [...keys];
}

function titleRomaji(s: string) {
  let t = s.toLowerCase().replace(/[_]+/g, "");
  t = t
    .replace(/airport/g, " Airport")
    .replace(/terminal\s*(\d)/g, " Terminal $1")
    .replace(/teleport/g, " Teleport")
    .replace(/shinkansen/g, " Shinkansen")
    .replace(/skytree/g, " Skytree")
    .replace(/tower/g, " Tower")
    .replace(/park/g, " Park")
    .replace(/^(nishi|higashi|minami|kita|shin|moto|kami|shimo|chuo|hon)(?=[a-z])/i, (m) => `${m}-`);
  return t
    .split(/(\s|-)/)
    .map((w) => (w === " " || w === "-" || !w ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

const EN_CACHE = new Map<string, string>();

export function toEn(text: string) {
  if (!text) return text;
  const cached = EN_CACHE.get(text);
  if (cached) return cached;
  if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) {
    EN_CACHE.set(text, text);
    return text;
  }
  let s = text;
  s = s.replace(/新幹線/g, " Shinkansen ");
  s = s.replace(/高速/g, " Rapid ");
  s = s.replace(/線/g, " Line ");
  s = s.replace(/[駅站]/g, " ");
  s = s.replace(/行き?/g, " ");
  s = s.replace(/[\u3040-\u30ff\u4e00-\u9fff]+/g, (run) => {
    const ja = toJa(run);
    const city = CITIES.find((c) => c.ja === ja || c.ja === run);
    if (city) return ` ${city.en} `;
    const special = SPECIAL[ja] ?? SPECIAL[run];
    const roma = special ?? romanizeName(ja)[0] ?? romanizeName(run)[0] ?? run;
    return ` ${titleRomaji(roma)} `;
  });
  const out = s.replace(/\s+/g, " ").trim();
  if (EN_CACHE.size > 5000) EN_CACHE.clear();
  EN_CACHE.set(text, out);
  return out;
}

(globalThis as unknown as { __jbToEn?: (s: string) => string }).__jbToEn = toEn;

