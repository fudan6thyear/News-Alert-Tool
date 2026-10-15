#!/usr/bin/env node
var __webpack_modules__ = {
    "./src/tools sync recursive \\.(js%7Cts)$" (module, __unused_rspack_exports, __webpack_require__) {
        var map = {
            "./36kr.ts": "./src/tools/36kr.ts",
            "./9to5mac.ts": "./src/tools/9to5mac.ts",
            "./__custom-rss.ts": "./src/tools/__custom-rss.ts",
            "./bbc.ts": "./src/tools/bbc.ts",
            "./bilibili.ts": "./src/tools/bilibili.ts",
            "./douban.ts": "./src/tools/douban.ts",
            "./douyin.ts": "./src/tools/douyin.ts",
            "./gcores.ts": "./src/tools/gcores.ts",
            "./ifanr.ts": "./src/tools/ifanr.ts",
            "./infoq.ts": "./src/tools/infoq.ts",
            "./juejin.ts": "./src/tools/juejin.ts",
            "./netease-news.ts": "./src/tools/netease-news.ts",
            "./nytimes.ts": "./src/tools/nytimes.ts",
            "./smzdm.ts": "./src/tools/smzdm.ts",
            "./sspai.ts": "./src/tools/sspai.ts",
            "./tencent-news.ts": "./src/tools/tencent-news.ts",
            "./thepaper.ts": "./src/tools/thepaper.ts",
            "./theverge.ts": "./src/tools/theverge.ts",
            "./toutiao.ts": "./src/tools/toutiao.ts",
            "./weibo.ts": "./src/tools/weibo.ts",
            "./weread.ts": "./src/tools/weread.ts",
            "./zhihu.ts": "./src/tools/zhihu.ts"
        };
        function __rspack_context(req) {
            var id = __rspack_context_resolve(req);
            return __webpack_require__(id);
        }
        function __rspack_context_resolve(req) {
            if (!__webpack_require__.o(map, req)) {
                var e = new Error("Cannot find module '" + req + "'");
                e.code = 'MODULE_NOT_FOUND';
                throw e;
            }
            return map[req];
        }
        __rspack_context.keys = function() {
            return Object.keys(map);
        };
        __rspack_context.resolve = __rspack_context_resolve;
        module.exports = __rspack_context;
        __rspack_context.id = "./src/tools sync recursive \\.(js%7Cts)$";
    },
    "./src/tools/36kr.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var zod__rspack_import_0 = __webpack_require__("zod");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const get36krRequestSchema = zod__rspack_import_0.z.object({
            type: zod__rspack_import_0.z.union([
                zod__rspack_import_0.z.literal('hot').describe('人气榜'),
                zod__rspack_import_0.z.literal('video').describe('视频榜'),
                zod__rspack_import_0.z.literal('comment').describe('热议榜'),
                zod__rspack_import_0.z.literal('collect').describe('收藏榜')
            ]).optional().default('hot').describe('分类')
        });
        const LIST_TYPE_MAP = {
            hot: 'hotRankList',
            video: 'videoList',
            comment: 'remarkList',
            collect: 'collectList'
        };
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)({
            name: 'get_36kr_trending',
            description: '获取 36 氪热榜，提供创业、商业、科技领域的热门资讯，包含投融资动态、新兴产业分析和商业模式创新信息',
            zodSchema: get36krRequestSchema,
            func: async (args)=>{
                const { type } = get36krRequestSchema.parse(args);
                const resp = await _utils__rspack_import_1.LV.post(`https://gateway.36kr.com/api/mis/nav/home/nav/rank/${type}`, {
                    partner_id: 'wap',
                    param: {
                        siteId: 1,
                        platformId: 2
                    },
                    timestamp: Date.now()
                }, {
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8'
                    }
                });
                return resp.data.data[LIST_TYPE_MAP[type]].map((item)=>{
                    const data = item.templateMaterial;
                    return {
                        title: data.widgetTitle,
                        cover: data.widgetImage,
                        author: data.authorName,
                        publish_time: (0, _utils__rspack_import_1.yf)(data.publishTime).toISOString(),
                        read_count: data.statRead,
                        collect_count: data.statCollect,
                        comment_count: data.statComment,
                        praise_count: data.statPraise,
                        link: `https://www.36kr.com/p/${data.itemId}`
                    };
                });
            }
        });
    },
    "./src/tools/9to5mac.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var _utils__rspack_import_0 = __webpack_require__("./src/utils/index.ts");
        const __rspack_default_export = (0, _utils__rspack_import_0.UW)({
            name: 'get_9to5mac_news',
            description: '获取 9to5Mac 苹果相关新闻，包含苹果产品发布、iOS 更新、Mac 硬件、应用推荐及苹果公司动态的英文资讯',
            func: ()=>(0, _utils__rspack_import_0.tV)('https://9to5mac.com/feed/')
        });
    },
    "./src/tools/__custom-rss.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var es_toolkit__rspack_import_0 = __webpack_require__("es-toolkit");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const getHostname = (url)=>{
            try {
                const hostname = new URL(url).hostname.replace(/^www\./, "");
                return (0, es_toolkit__rspack_import_0.snakeCase)(hostname);
            } catch  {
                return "unknown";
            }
        };
        const resolveNameConflicts = (names)=>{
            const count = new Map();
            return names.map((name)=>{
                const currentCount = count.get(name) ?? 0;
                count.set(name, currentCount + 1);
                return 0 === currentCount ? name : `${name}_${currentCount + 1}`;
            });
        };
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)(async ()=>{
            const rssUrls = process.env.TRENDS_HUB_CUSTOM_RSS_URL;
            if (!rssUrls) throw new Error("TRENDS_HUB_CUSTOM_RSS_URL not found");
            const urls = rssUrls.split(",").map((url)=>url.trim()).filter(Boolean);
            const baseNames = urls.map(getHostname);
            const resolvedNames = resolveNameConflicts(baseNames);
            const toolConfigs = await Promise.all(urls.map(async (rssUrl, index)=>{
                const resp = await (0, _utils__rspack_import_1.lU)(rssUrl);
                if (!resp?.rss?.channel) throw new Error(`Invalid RSS feed: ${rssUrl}`);
                let description = resp.rss.channel.title;
                if (resp.rss.channel.description) description += ` - ${resp.rss.channel.description}`;
                return {
                    name: resolvedNames[index],
                    description,
                    func: ()=>(0, _utils__rspack_import_1.tV)(rssUrl)
                };
            }));
            return toolConfigs;
        });
    },
    "./src/tools/bbc.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var zod__rspack_import_0 = __webpack_require__("zod");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const bbcRequestSchema = zod__rspack_import_0.z.object({
            category: zod__rspack_import_0.z.union([
                zod__rspack_import_0.z.literal("").describe("热门新闻"),
                zod__rspack_import_0.z.literal("world").describe("国际"),
                zod__rspack_import_0.z.literal("uk").describe("英国"),
                zod__rspack_import_0.z.literal("business").describe("商业"),
                zod__rspack_import_0.z.literal("politics").describe("政治"),
                zod__rspack_import_0.z.literal("health").describe("健康"),
                zod__rspack_import_0.z.literal("education").describe("教育"),
                zod__rspack_import_0.z.literal("science_and_environment").describe("科学与环境"),
                zod__rspack_import_0.z.literal("technology").describe("科技"),
                zod__rspack_import_0.z.literal("entertainment_and_arts").describe("娱乐与艺术")
            ]).optional().default(""),
            edition: zod__rspack_import_0.z.union([
                zod__rspack_import_0.z.literal(""),
                zod__rspack_import_0.z.literal("uk").describe("UK"),
                zod__rspack_import_0.z.literal("us").describe("US & Canada"),
                zod__rspack_import_0.z.literal("int").describe("Rest of the world")
            ]).optional().default("").describe("版本，仅对 `category` 为空有效")
        });
        const getUrl = (category, edition)=>{
            let url = "https://feeds.bbci.co.uk/news/";
            if (category) url += `${category}/`;
            url += "rss.xml";
            if (edition) url += `?edition=${edition}`;
            return url;
        };
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)({
            name: "get_bbc_news",
            description: "获取 BBC 新闻，提供全球新闻、英国新闻、商业、政治、健康、教育、科技、娱乐等资讯",
            zodSchema: bbcRequestSchema,
            func: async (args)=>{
                const { category, edition } = bbcRequestSchema.parse(args);
                const url = getUrl(category, edition);
                return (0, _utils__rspack_import_1.tV)(url);
            }
        });
    },
    "./src/tools/bilibili.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var node_crypto__rspack_import_0 = __webpack_require__("node:crypto");
        var node_url__rspack_import_1 = __webpack_require__("node:url");
        var zod__rspack_import_2 = __webpack_require__("zod");
        var _utils__rspack_import_3 = __webpack_require__("./src/utils/index.ts");
        const bilibiliRequestSchema = zod__rspack_import_2.z.object({
            type: zod__rspack_import_2.z.union([
                zod__rspack_import_2.z.literal(0).describe("全站"),
                zod__rspack_import_2.z.literal(1).describe("动画"),
                zod__rspack_import_2.z.literal(3).describe("音乐"),
                zod__rspack_import_2.z.literal(4).describe("游戏"),
                zod__rspack_import_2.z.literal(5).describe("娱乐"),
                zod__rspack_import_2.z.literal(188).describe("科技"),
                zod__rspack_import_2.z.literal(119).describe("鬼畜"),
                zod__rspack_import_2.z.literal(129).describe("舞蹈"),
                zod__rspack_import_2.z.literal(155).describe("时尚"),
                zod__rspack_import_2.z.literal(160).describe("生活"),
                zod__rspack_import_2.z.literal(168).describe("国创相关"),
                zod__rspack_import_2.z.literal(181).describe("影视")
            ]).optional().default(0).describe("排行榜分区")
        });
        const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
        const encodeWbi = (params, imgKey, subKey)=>{
            const chrFilter = /[!'()*]/g;
            const search = new node_url__rspack_import_1.URLSearchParams();
            const paramsWithTs = {
                ...params,
                wts: (0, _utils__rspack_import_3.yf)().unix().toString()
            };
            const sortedKeys = Object.keys(paramsWithTs).sort();
            for (const key of sortedKeys){
                const value = paramsWithTs[key].toString().replace(chrFilter, "");
                search.set(key, value);
            }
            const mixinKey = [
                46,
                47,
                18,
                2,
                53,
                8,
                23,
                32,
                15,
                50,
                10,
                31,
                58,
                3,
                45,
                35,
                27,
                43,
                5,
                49,
                33,
                9,
                42,
                19,
                29,
                28,
                14,
                39,
                12,
                38,
                41,
                13,
                37,
                48,
                7,
                16,
                24,
                55,
                40,
                61,
                26,
                17,
                0,
                1,
                60,
                51,
                30,
                4,
                22,
                25,
                54,
                21,
                56,
                59,
                6,
                63,
                57,
                62,
                11,
                36,
                20,
                34,
                44,
                52
            ].map((n)=>`${imgKey}${subKey}`[n]).join("").slice(0, 32);
            const wbiSign = (0, node_crypto__rspack_import_0.createHash)("md5").update(search.toString() + mixinKey).digest("hex");
            search.set("w_rid", wbiSign);
            return search.toString();
        };
        const getWbiKeys = async ()=>{
            const resp = await _utils__rspack_import_3.LV.get("https://api.bilibili.com/x/web-interface/nav", {
                headers: {
                    Cookie: "SESSDATA=xxxxxx",
                    "User-Agent": UA,
                    Referer: "https://www.bilibili.com/"
                }
            });
            const { img_url: imgUrl = "", sub_url: subUrl = "" } = resp.data.data.wbi_img;
            const getFileNameFromUrl = (url)=>url.slice(url.lastIndexOf("/") + 1, url.lastIndexOf("."));
            return {
                imgKey: getFileNameFromUrl(imgUrl),
                subKey: getFileNameFromUrl(subUrl)
            };
        };
        const getBiliWbi = async ()=>{
            const CACHE_KEY = "bilibili-wbi";
            const cachedData = _utils__rspack_import_3.UU.getItem(CACHE_KEY);
            if (cachedData) return cachedData;
            const { imgKey, subKey } = await getWbiKeys();
            const params = {
                foo: "114",
                bar: "514",
                baz: "1919810"
            };
            const query = encodeWbi(params, imgKey, subKey);
            _utils__rspack_import_3.UU.setItem(CACHE_KEY, query);
            return query;
        };
        const mainGetBilibiliRank = async (type)=>{
            const wbiData = await getBiliWbi();
            const resp = await _utils__rspack_import_3.LV.get(`https://api.bilibili.com/x/web-interface/ranking/v2?rid=${type}&type=all&${wbiData}`, {
                headers: {
                    Referer: "https://www.bilibili.com/ranking/all",
                    "User-Agent": UA,
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Sec-Ch-Ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
                    "Sec-Ch-Ua-Mobile": "?0",
                    "Sec-Ch-Ua-Platform": '"Windows"',
                    "Sec-Fetch-Dest": "document",
                    "Sec-Fetch-Mode": "navigate",
                    "Sec-Fetch-Site": "same-origin",
                    "Sec-Fetch-User": "?1",
                    "Upgrade-Insecure-Requests": "1"
                }
            });
            if (0 !== resp.data.code) throw new Error(resp.data.message);
            return resp.data.data.list.map((item)=>({
                    title: item.title,
                    description: item.desc || "该视频暂无简介",
                    cover: item.pic,
                    author: item.owner?.name,
                    publishTime: _utils__rspack_import_3.yf.unix(item.pubdate).toISOString(),
                    view: item.stat?.view || 0,
                    link: item.short_link_v2 || `https://www.bilibili.com/video/${item.bvid}`
                }));
        };
        const backupGetBilibiliRank = async (type)=>{
            const resp = await _utils__rspack_import_3.LV.get(`https://api.bilibili.com/x/web-interface/ranking?jsonp=jsonp?rid=${type}&type=all&callback=__jp0`, {
                headers: {
                    Referer: "https://www.bilibili.com/ranking/all",
                    "User-Agent": UA
                }
            });
            if (0 !== resp.data.code) throw new Error(resp.data.message);
            return resp.data.data.list.map((item)=>({
                    title: item.title,
                    description: item.desc || "该视频暂无简介",
                    cover: item.pic,
                    author: item.author,
                    view: item.video_review,
                    link: `https://www.bilibili.com/video/${item.bvid}`
                }));
        };
        const getBilibiliRank = async (type)=>{
            try {
                return await mainGetBilibiliRank(type);
            } catch (error) {
                _utils__rspack_import_3.vF.error(error);
                return await backupGetBilibiliRank(type);
            }
        };
        const __rspack_default_export = (0, _utils__rspack_import_3.UW)({
            name: "get_bilibili_rank",
            description: "获取哔哩哔哩视频排行榜，包含全站、动画、音乐、游戏等多个分区的热门视频，反映当下年轻人的内容消费趋势",
            zodSchema: bilibiliRequestSchema,
            func: async (args)=>{
                const { type } = bilibiliRequestSchema.parse(args);
                return getBilibiliRank(type);
            }
        });
    },
    "./src/tools/douban.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var zod__rspack_import_0 = __webpack_require__("zod");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const doubanRankSchema = zod__rspack_import_0.z.object({
            type: zod__rspack_import_0.z.union([
                zod__rspack_import_0.z.literal('subject').describe('图书、电影、电视剧、综艺等'),
                zod__rspack_import_0.z.literal('movie').describe('电影'),
                zod__rspack_import_0.z.literal('tv').describe('电视剧')
            ]).optional().default('subject'),
            start: zod__rspack_import_0.z.number().int().optional().default(0),
            count: zod__rspack_import_0.z.number().int().optional().default(10)
        });
        const URL_MAP = {
            subject: 'https://m.douban.com/rexxar/api/v2/subject_collection/subject_real_time_hotest/items',
            movie: 'https://m.douban.com/rexxar/api/v2/subject_collection/movie_real_time_hotest/items',
            tv: 'https://m.douban.com/rexxar/api/v2/subject_collection/tv_real_time_hotest/items'
        };
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)({
            name: 'get_douban_rank',
            description: '获取豆瓣实时热门榜单，提供当前热门的图书、电影、电视剧、综艺等作品信息，包含评分和热度数据',
            zodSchema: doubanRankSchema,
            func: async (args)=>{
                const { type, start, count } = doubanRankSchema.parse(args);
                const resp = await _utils__rspack_import_1.LV.get(URL_MAP[type], {
                    params: {
                        type,
                        start,
                        count,
                        for_mobile: 1
                    },
                    headers: {
                        Referer: 'https://m.douban.com/subject_collection/movie_real_time_hotest'
                    }
                });
                if (!Array.isArray(resp.data.subject_collection_items)) throw new Error('获取豆瓣实时热门榜失败');
                return resp.data.subject_collection_items.map((item)=>({
                        type_name: item.type_name,
                        title: item.title,
                        info: item.info,
                        cover: item.cover.url,
                        year: item.year,
                        release_date: item.release_date,
                        link: item.url,
                        popularity: item.score,
                        rating_count: item.rating.count,
                        rating_value: item.rating.count > 0 ? item.rating.value : void 0,
                        hashtags: item.related_search_terms.map((term)=>`#${term.name}`).join(' ')
                    }));
            }
        });
    },
    "./src/tools/douyin.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var _utils__rspack_import_0 = __webpack_require__("./src/utils/index.ts");
        const csrfCookieName = [
            "passport",
            "csrf",
            "token"
        ].join("_");
        const getCsrfToken = async ()=>{
            try {
                const reps = await _utils__rspack_import_0.LV.get("https://www.douyin.com/passport/general/login_guiding_strategy/", {
                    params: {
                        aid: 6383
                    }
                });
                const pattern = new RegExp(`${csrfCookieName}=([^;]*); Path`);
                const matchResult = reps.headers["set-cookie"]?.[0].match(pattern);
                const csrfToken = matchResult?.[1];
                return csrfToken;
            } catch (error) {
                return;
            }
        };
        const __rspack_default_export = (0, _utils__rspack_import_0.UW)({
            name: "get_douyin_trending",
            description: "获取抖音热搜榜单，展示当下最热门的社会话题、娱乐事件、网络热点和流行趋势",
            func: async ()=>{
                const csrfToken = await getCsrfToken();
                const resp = await _utils__rspack_import_0.LV.get("https://www.douyin.com/aweme/v1/web/hot/search/list/", {
                    params: {
                        device_platform: "webapp",
                        aid: 6383,
                        channel: "channel_pc_web",
                        detail_list: 1
                    },
                    headers: {
                        Cookie: `${csrfCookieName}=${csrfToken}`
                    }
                });
                if (resp.data?.status_code !== 0 || !Array.isArray(resp.data.data.word_list)) throw new Error("获取抖音热榜失败");
                return resp.data.data.word_list.map((item)=>({
                        title: item.word,
                        eventTime: _utils__rspack_import_0.yf.unix(item.event_time).toISOString(),
                        cover: item.word_cover?.url_list?.[0],
                        popularity: item.hot_value,
                        link: `https://www.douyin.com/hot/${item.sentence_id}`
                    }));
            }
        });
    },
    "./src/tools/gcores.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var _utils__rspack_import_0 = __webpack_require__("./src/utils/index.ts");
        const __rspack_default_export = (0, _utils__rspack_import_0.UW)({
            name: 'get_gcores_new',
            description: '获取机核网游戏相关资讯，包含电子游戏评测、玩家文化、游戏开发和游戏周边产品的深度内容',
            func: ()=>(0, _utils__rspack_import_0.tV)('https://www.gcores.com/rss')
        });
    },
    "./src/tools/ifanr.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var zod__rspack_import_0 = __webpack_require__("zod");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const ifanrRequestSchema = zod__rspack_import_0.z.object({
            limit: zod__rspack_import_0.z.number().int().optional().default(20),
            offset: zod__rspack_import_0.z.number().int().optional().default(0)
        });
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)({
            name: "get_ifanr_news",
            description: "获取爱范儿科技快讯，包含最新的科技产品、数码设备、互联网动态等前沿科技资讯",
            zodSchema: ifanrRequestSchema,
            func: async (args)=>{
                const { limit, offset } = ifanrRequestSchema.parse(args);
                const resp = await _utils__rspack_import_1.LV.get("https://sso.ifanr.com/api/v5/wp/buzz", {
                    params: {
                        limit,
                        offset
                    }
                });
                if (!Array.isArray(resp.data.objects)) throw new Error("获取爱范儿快讯失败");
                return resp.data.objects.map((item)=>({
                        title: item.post_title,
                        description: item.post_content,
                        link: item.buzz_original_url || `https://www.ifanr.com/${item.post_id}`
                    }));
            }
        });
    },
    "./src/tools/infoq.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var es_toolkit__rspack_import_0 = __webpack_require__("es-toolkit");
        var zod__rspack_import_1 = __webpack_require__("zod");
        var _utils__rspack_import_2 = __webpack_require__("./src/utils/index.ts");
        const infoqRequestSchema = zod__rspack_import_1.z.object({
            region: zod__rspack_import_1.z["enum"]([
                "cn",
                "global"
            ]).optional().default("cn")
        });
        const getUrl = (region)=>({
                cn: "https://www.infoq.cn/feed",
                global: "https://feed.infoq.com/"
            })[region];
        const __rspack_default_export = (0, _utils__rspack_import_2.UW)({
            name: "get_infoq_news",
            description: "获取 InfoQ 技术资讯，包含软件开发、架构设计、云计算、AI等企业级技术内容和前沿开发者动态",
            zodSchema: infoqRequestSchema,
            func: async (args)=>{
                const { region } = infoqRequestSchema.parse(args);
                const url = getUrl(region);
                const resp = await (0, _utils__rspack_import_2.tV)(url);
                if ("cn" === region) return resp.map((item)=>(0, es_toolkit__rspack_import_0.omit)(item, [
                        "description"
                    ]));
                return resp;
            }
        });
    },
    "./src/tools/juejin.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var zod__rspack_import_0 = __webpack_require__("zod");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Sec-Ch-Ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1"
        };
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)(async ()=>{
            const categoryResp = await _utils__rspack_import_1.LV.get("https://api.juejin.cn/tag_api/v1/query_category_briefs", {
                headers
            });
            if (0 !== categoryResp.data.err_no) throw new Error("获取掘金分类失败");
            const juejinRequestSchema = zod__rspack_import_0.z.object({
                category_id: zod__rspack_import_0.z.union(categoryResp.data.data.map((item)=>zod__rspack_import_0.z.literal(item.category_id).describe(item.category_name))).optional().default(categoryResp.data.data[0].category_id)
            });
            return {
                name: "get_juejin_article_rank",
                description: "获取掘金文章榜，包含前端开发、后端技术、人工智能、移动开发及技术架构等领域的高质量中文技术文章和教程",
                zodSchema: juejinRequestSchema,
                func: async (args)=>{
                    const { category_id } = juejinRequestSchema.parse(args);
                    const resp = await _utils__rspack_import_1.LV.get("https://api.juejin.cn/content_api/v1/content/article_rank", {
                        params: {
                            category_id,
                            type: "hot"
                        },
                        headers
                    });
                    if (0 !== resp.data.err_no) throw new Error(resp.data.err_msg || "获取掘金文章榜失败");
                    return resp.data.data.map((item)=>({
                            title: item.content.title,
                            brief: item.content.brief || void 0,
                            author: item.author.name,
                            popularity: item.content_counter.hot_rank,
                            view_count: item.content_counter.view,
                            like_count: item.content_counter.like,
                            collect_count: item.content_counter.collect,
                            comment_count: item.content_counter.comment_count,
                            interact_count: item.content_counter.interact_count,
                            link: `https://juejin.cn/post/${item.content.content_id}`
                        }));
                }
            };
        });
    },
    "./src/tools/netease-news.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var _utils__rspack_import_0 = __webpack_require__("./src/utils/index.ts");
        const __rspack_default_export = (0, _utils__rspack_import_0.UW)({
            name: "get_netease_news_trending",
            description: "获取网易新闻热点榜，包含时政要闻、社会事件、财经资讯、科技动态及娱乐体育的全方位中文新闻资讯",
            func: async ()=>{
                const resp = await _utils__rspack_import_0.LV.get("https://m.163.com/fe/api/hot/news/flow");
                if (200 !== resp.data.code || !Array.isArray(resp.data.data.list)) throw new Error("获取网易新闻热点榜失败");
                return resp.data.data.list.map((item)=>({
                        title: item.title,
                        cover: item.imgsrc,
                        source: item.source,
                        publish_time: item.ptime,
                        link: item.url
                    }));
            }
        });
    },
    "./src/tools/nytimes.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var zod__rspack_import_0 = __webpack_require__("zod");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const nytimesRequestSchema = zod__rspack_import_0.z.object({
            region: zod__rspack_import_0.z.union([
                zod__rspack_import_0.z.literal("cn").describe("中文"),
                zod__rspack_import_0.z.literal("global").describe("全球")
            ]).optional().default("cn"),
            section: zod__rspack_import_0.z.string().optional().default("HomePage").describe("分类，当 `region` 为 `cn` 时无效。可选值: Africa, Americas, ArtandDesign, Arts, AsiaPacific, Automobiles, Baseball, Books/Review, Business, Climate, CollegeBasketball, CollegeFootball, Dance, Dealbook, DiningandWine, Economy, Education, EnergyEnvironment, Europe, FashionandStyle, Golf, Health, Hockey, HomePage, Jobs, Lens, MediaandAdvertising, MiddleEast, MostEmailed, MostShared, MostViewed, Movies, Music, NYRegion, Obituaries, PersonalTech, Politics, ProBasketball, ProFootball, RealEstate, Science, SmallBusiness, Soccer, Space, Sports, SundayBookReview, Sunday-Review, Technology, Television, Tennis, Theater, TMagazine, Travel, Upshot, US, Weddings, Well, World, YourMoney")
        });
        const getUrl = (region, section)=>{
            if ("cn" === region) return "https://cn.nytimes.com/rss/";
            return `https://rss.nytimes.com/services/xml/rss/nyt/${section || "HomePage"}.xml`;
        };
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)({
            name: "get_nytimes_news",
            description: "获取纽约时报新闻，包含国际政治、经济金融、社会文化、科学技术及艺术评论的高质量英文或中文国际新闻资讯",
            zodSchema: nytimesRequestSchema,
            func: async (args)=>{
                const { region, section } = nytimesRequestSchema.parse(args);
                const url = getUrl(region, section);
                return (0, _utils__rspack_import_1.tV)(url);
            }
        });
    },
    "./src/tools/smzdm.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var zod__rspack_import_0 = __webpack_require__("zod");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const smzdmRequestSchema = zod__rspack_import_0.z.object({
            unit: zod__rspack_import_0.z.union([
                zod__rspack_import_0.z.literal(1).describe("今日热门"),
                zod__rspack_import_0.z.literal(7).describe("周热门"),
                zod__rspack_import_0.z.literal(30).describe("月热门")
            ]).optional().default(1)
        });
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)({
            name: "get_smzdm_rank",
            description: "获取什么值得买热门，包含商品推荐、优惠信息、购物攻略、产品评测及消费经验分享的实用中文消费类资讯",
            zodSchema: smzdmRequestSchema,
            func: async (args)=>{
                const { unit } = smzdmRequestSchema.parse(args);
                const resp = await _utils__rspack_import_1.LV.get("https://post.smzdm.com/rank/json_more", {
                    params: {
                        unit
                    }
                });
                if (0 !== resp.data.error_code || !Array.isArray(resp.data.data)) throw new Error(resp.data.error_msg || "获取什么值得买热门失败");
                return resp.data.data.map((item)=>({
                        title: item.title,
                        description: item.content,
                        cover: item.pic_url,
                        author: item.nickname,
                        publish_time: item.publish_time,
                        collection_count: item.collection_count,
                        comment_count: item.comment_count,
                        up_count: item.up_count,
                        hashtags: (0, _utils__rspack_import_1.jD)(item.tag)?.map((tag)=>`#${tag.title}`).join(" "),
                        link: item.article_url
                    }));
            }
        });
    },
    "./src/tools/sspai.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var zod__rspack_import_0 = __webpack_require__("zod");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const sspaiRequestSchema = zod__rspack_import_0.z.object({
            tag: zod__rspack_import_0.z["enum"]([
                "热门文章",
                "应用推荐",
                "生活方式",
                "效率技巧",
                "少数派播客"
            ]).optional().default("热门文章").describe("分类"),
            limit: zod__rspack_import_0.z.number().int().optional().default(40)
        });
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)({
            name: "get_sspai_rank",
            description: "获取少数派热榜，包含数码产品评测、软件应用推荐、生活方式指南及效率工作技巧的优质中文科技生活类内容",
            zodSchema: sspaiRequestSchema,
            func: async (args)=>{
                const { tag, limit } = sspaiRequestSchema.parse(args);
                const resp = await _utils__rspack_import_1.LV.get("https://sspai.com/api/v1/article/tag/page/get", {
                    params: {
                        tag,
                        limit
                    }
                });
                if (0 !== resp.data.error || !Array.isArray(resp.data.data)) throw new Error(resp.data.msg || "获取少数派热榜失败");
                return resp.data.data.map((item)=>({
                        title: item.title,
                        summary: item.summary,
                        author: item.author.nickname,
                        released_time: _utils__rspack_import_1.yf.unix(item.released_time).toISOString(),
                        comment_count: item.comment_count,
                        like_count: item.like_count,
                        view_count: item.view_count,
                        link: `https://sspai.com/post/${item.id}`
                    }));
            }
        });
    },
    "./src/tools/tencent-news.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var zod__rspack_import_0 = __webpack_require__("zod");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const tencentNewsRequestSchema = zod__rspack_import_0.z.object({
            page_size: zod__rspack_import_0.z.number().int().optional().default(20)
        });
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)({
            name: "get_tencent_news_trending",
            description: "获取腾讯新闻热点榜，包含国内外时事、社会热点、财经资讯、娱乐动态及体育赛事的综合性中文新闻资讯",
            zodSchema: tencentNewsRequestSchema,
            func: async (args)=>{
                const { page_size } = tencentNewsRequestSchema.parse(args);
                const resp = await _utils__rspack_import_1.LV.get("https://r.inews.qq.com/gw/event/hot_ranking_list", {
                    params: {
                        page_size
                    }
                });
                if (0 !== resp.data.ret || !Array.isArray(resp.data.idlist?.[0].newslist)) throw new Error("获取腾讯新闻热点榜失败");
                return resp.data.idlist[0].newslist.filter((_, index)=>0 !== index).map((item)=>({
                        title: item.title,
                        description: item.abstract,
                        cover: item.thumbnails?.[0],
                        source: item.source,
                        popularity: item.hotEvent.hotScore,
                        publish_time: item.time,
                        link: item.url
                    }));
            }
        });
    },
    "./src/tools/thepaper.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var _utils__rspack_import_0 = __webpack_require__("./src/utils/index.ts");
        const __rspack_default_export = (0, _utils__rspack_import_0.UW)({
            name: "get_thepaper_trending",
            description: "获取澎湃新闻热榜，包含时政要闻、财经动态、社会事件、文化教育及深度报道的高质量中文新闻资讯",
            func: async ()=>{
                const resp = await _utils__rspack_import_0.LV.get("https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar");
                if (1 !== resp.data.resultCode || !Array.isArray(resp.data.data.hotNews)) throw new Error(resp.data.resultMsg || "获取澎湃新闻热榜失败");
                return resp.data.data.hotNews.map((item)=>({
                        title: item.name,
                        cover: item.pic,
                        popularity: item.praiseTimes,
                        publish_time: (0, _utils__rspack_import_0.yf)(item.pubTimeLong).toISOString(),
                        hashtags: item.tagList?.map((tag)=>`#${tag.tag}`).join(" "),
                        link: `https://www.thepaper.cn/newsDetail_forward_${item.contId}`
                    }));
            }
        });
    },
    "./src/tools/theverge.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var node_url__rspack_import_0 = __webpack_require__("node:url");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)({
            name: "get_theverge_news",
            description: "获取 The Verge 新闻，包含科技创新、数码产品评测、互联网趋势及科技公司动态的英文科技资讯",
            func: async ()=>{
                const rss = await (0, _utils__rspack_import_1.lU)("https://www.theverge.com/rss/index.xml");
                if (!Array.isArray(rss.feed.entry)) throw new Error("获取 The Verge 新闻失败");
                return rss.feed.entry.map((item)=>{
                    let link = item.link;
                    if (!link && item.id) link = item.id;
                    const url = new node_url__rspack_import_0.URL(link);
                    if (url.searchParams.has("p")) {
                        url.pathname = url.searchParams.get("p");
                        url.search = "";
                        link = url.toString();
                    }
                    return {
                        title: item.title,
                        description: item.summary,
                        publish_time: item.published,
                        link
                    };
                });
            }
        });
    },
    "./src/tools/toutiao.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var node_url__rspack_import_0 = __webpack_require__("node:url");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)({
            name: "get_toutiao_trending",
            description: "获取今日头条热榜，包含时政要闻、社会事件、国际新闻、科技发展及娱乐八卦等多领域的热门中文资讯",
            func: async ()=>{
                const resp = await _utils__rspack_import_1.LV.get("https://www.toutiao.com/hot-event/hot-board/", {
                    params: {
                        origin: "toutiao_pc"
                    }
                });
                if (!Array.isArray(resp.data.data)) throw new Error("获取今日头条热榜失败");
                return resp.data.data.map((item)=>{
                    const link = new node_url__rspack_import_0.URL(item.Url);
                    link.search = "";
                    return {
                        title: item.Title,
                        cover: item.Image.url,
                        popularity: item.HotValue,
                        link: link.toString()
                    };
                });
            }
        });
    },
    "./src/tools/weibo.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var node_url__rspack_import_0 = __webpack_require__("node:url");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)({
            name: 'get_weibo_trending',
            description: '获取微博热搜榜，包含时事热点、社会现象、娱乐新闻、明星动态及网络热议话题的实时热门中文资讯',
            func: async ()=>{
                const resp = await _utils__rspack_import_1.LV.get('https://weibo.com/ajax/side/hotSearch', {
                    headers: {
                        Referer: 'https://weibo.com/',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });
                if (1 !== resp.data.ok || !Array.isArray(resp.data.data.realtime)) throw new Error('获取微博热搜榜失败');
                return resp.data.data.realtime.filter((item)=>1 !== item.is_ad).map((item)=>{
                    const key = item.word_scheme || `#${item.word}`;
                    const url = new node_url__rspack_import_0.URL('https://s.weibo.com/weibo');
                    url.searchParams.set('q', key);
                    url.searchParams.set('band_rank', '1');
                    url.searchParams.set('Refer', 'top');
                    return {
                        title: item.word,
                        description: item.note || key,
                        popularity: item.num,
                        link: url.toString()
                    };
                });
            }
        });
    },
    "./src/tools/weread.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var node_crypto__rspack_import_0 = __webpack_require__("node:crypto");
        var node_crypto__rspack_import_0_default = /*#__PURE__*/ __webpack_require__.n(node_crypto__rspack_import_0);
        var zod__rspack_import_1 = __webpack_require__("zod");
        var _utils__rspack_import_2 = __webpack_require__("./src/utils/index.ts");
        const wereadRequestSchema = zod__rspack_import_1.z.object({
            category: zod__rspack_import_1.z.union([
                zod__rspack_import_1.z.literal("rising").describe("飙升榜"),
                zod__rspack_import_1.z.literal("hot_search").describe("热搜榜"),
                zod__rspack_import_1.z.literal("newbook").describe("新书榜"),
                zod__rspack_import_1.z.literal("general_novel_rising").describe("小说榜"),
                zod__rspack_import_1.z.literal("all").describe("总榜")
            ]).optional().default("rising").describe("排行榜分区")
        });
        const getWereadID = (bookId)=>{
            try {
                const hash = node_crypto__rspack_import_0_default().createHash("md5");
                hash.update(bookId);
                const str = hash.digest("hex");
                let strSub = str.substring(0, 3);
                let fa;
                if (/^\d*$/.test(bookId)) {
                    const chunks = [];
                    for(let i = 0; i < bookId.length; i += 9){
                        const chunk = bookId.substring(i, i + 9);
                        chunks.push(Number.parseInt(chunk).toString(16));
                    }
                    fa = [
                        "3",
                        chunks
                    ];
                } else {
                    let hexStr = "";
                    for(let i = 0; i < bookId.length; i++)hexStr += bookId.charCodeAt(i).toString(16);
                    fa = [
                        "4",
                        [
                            hexStr
                        ]
                    ];
                }
                strSub += fa[0];
                strSub += `2${str.substring(str.length - 2)}`;
                for(let i = 0; i < fa[1].length; i++){
                    const sub = fa[1][i];
                    const subLength = sub.length.toString(16);
                    const subLengthPadded = 1 === subLength.length ? `0${subLength}` : subLength;
                    strSub += subLengthPadded + sub;
                    if (i < fa[1].length - 1) strSub += "g";
                }
                if (strSub.length < 20) strSub += str.substring(0, 20 - strSub.length);
                const finalHash = node_crypto__rspack_import_0_default().createHash("md5");
                finalHash.update(strSub);
                const finalStr = finalHash.digest("hex");
                strSub += finalStr.substring(0, 3);
                return strSub;
            } catch (error) {
                _utils__rspack_import_2.vF.error(`处理微信读书 ID 时出现错误：${error}`);
                return;
            }
        };
        const __rspack_default_export = (0, _utils__rspack_import_2.UW)({
            name: "get_weread_rank",
            description: "获取微信读书排行榜，包含热门小说、畅销书籍、新书推荐及各类文学作品的阅读数据和排名信息",
            zodSchema: wereadRequestSchema,
            func: async (args)=>{
                const { category } = wereadRequestSchema.parse(args);
                const resp = await _utils__rspack_import_2.LV.get(`https://weread.qq.com/web/bookListInCategory/${category}`, {
                    params: {
                        rank: 1
                    }
                });
                if (!Array.isArray(resp.data.books)) throw new Error("获取微信读书排行榜失败");
                return resp.data.books.map((item)=>{
                    const { bookInfo } = item;
                    const wereadID = getWereadID(bookInfo.bookId);
                    return {
                        title: bookInfo.title,
                        description: bookInfo.intro,
                        cover: bookInfo.cover?.replace("s_", "t9_"),
                        author: bookInfo.author,
                        publish_time: bookInfo.publishTime,
                        reading_count: item.readingCount,
                        link: wereadID ? `https://weread.qq.com/web/bookDetail/${wereadID}` : void 0
                    };
                });
            }
        });
    },
    "./src/tools/zhihu.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
            default: ()=>__rspack_default_export
        });
        var zod__rspack_import_0 = __webpack_require__("zod");
        var _utils__rspack_import_1 = __webpack_require__("./src/utils/index.ts");
        const zhihuTrendingSchema = zod__rspack_import_0.z.object({
            limit: zod__rspack_import_0.z.number().optional().default(50)
        });
        const __rspack_default_export = (0, _utils__rspack_import_1.UW)({
            name: "get_zhihu_trending",
            description: "获取知乎热榜，包含时事热点、社会话题、科技动态、娱乐八卦等多领域的热门问答和讨论的中文资讯",
            zodSchema: zhihuTrendingSchema,
            func: async (args)=>{
                const { limit } = zhihuTrendingSchema.parse(args);
                const resp = await _utils__rspack_import_1.LV.get("https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total", {
                    params: {
                        limit
                    },
                    headers: {
                        "User-Agent": "osee2unifiedRelease/22916 osee2unifiedReleaseVersion/10.49.0 Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
                        "x-app-versioncode": "22916",
                        "x-app-bundleid": "com.zhihu.ios",
                        "x-app-build": "release",
                        "x-package-ytpe": "appstore",
                        "x-app-za": "OS=iOS&Release=18.5&Model=iPhone17,2&VersionName=10.49.0&VersionCode=22916&Width=1290&Height=2796&DeviceType=Phone&Brand=Apple&OperatorType=6553565535"
                    }
                });
                if (!Array.isArray(resp.data.data)) throw new Error("获取知乎热榜失败");
                return resp.data.data.map((item)=>{
                    const data = item.target;
                    const id = item.target?.url.split("/").pop();
                    return {
                        title: data.title,
                        description: data.excerpt,
                        cover: item.children[0].thumbnail,
                        created: _utils__rspack_import_1.yf.unix(data.created).toISOString(),
                        popularity: item.detail_text,
                        link: id ? `https://www.zhihu.com/question/${id}` : void 0
                    };
                });
            }
        });
    },
    "./src/utils/index.ts" (__unused_rspack_module, __webpack_exports__, __webpack_require__) {
        "use strict";
        __webpack_require__.d(__webpack_exports__, {
            UU: ()=>cacheStorage,
            s8: ()=>loadToolConfigs,
            vF: ()=>logger,
            UW: ()=>defineToolConfig,
            JR: ()=>handleSuccessResult,
            jD: ()=>safeJsonParse,
            tV: ()=>getRssItems,
            lU: ()=>getRss,
            Kd: ()=>handleErrorResult,
            LV: ()=>http,
            yf: ()=>external_dayjs_default()
        });
        const external_node_fs_namespaceObject = require("node:fs");
        var external_node_fs_default = /*#__PURE__*/ __webpack_require__.n(external_node_fs_namespaceObject);
        const external_node_os_namespaceObject = require("node:os");
        var external_node_os_default = /*#__PURE__*/ __webpack_require__.n(external_node_os_namespaceObject);
        const external_node_path_namespaceObject = require("node:path");
        var external_node_path_default = /*#__PURE__*/ __webpack_require__.n(external_node_path_namespaceObject);
        class CacheStorage {
            get cachePath() {
                const cachePath = external_node_path_default().join(external_node_os_default().tmpdir(), "mcp-trends-hub", "cache");
                if (!external_node_fs_default().existsSync(cachePath)) external_node_fs_default().mkdirSync(cachePath, {
                    recursive: true
                });
                return cachePath;
            }
            getPathByKey(key) {
                return external_node_path_default().join(this.cachePath, key);
            }
            getItem(key) {
                const itemPath = this.getPathByKey(key);
                if (!external_node_fs_default().existsSync(itemPath)) return null;
                return external_node_fs_default().readFileSync(itemPath, "utf-8");
            }
            setItem(key, value) {
                const itemPath = this.getPathByKey(key);
                external_node_fs_default().writeFileSync(itemPath, value);
            }
            removeItem(key) {
                const itemPath = this.getPathByKey(key);
                if (!external_node_fs_default().existsSync(itemPath)) return;
                external_node_fs_default().unlinkSync(itemPath);
            }
            clear() {
                external_node_fs_default().rmSync(this.cachePath, {
                    recursive: true
                });
            }
        }
        const cacheStorage = new CacheStorage();
        const external_dayjs_namespaceObject = require("dayjs");
        var external_dayjs_default = /*#__PURE__*/ __webpack_require__.n(external_dayjs_namespaceObject);
        const zh_cn_js_namespaceObject = require("dayjs/locale/zh-cn.js");
        var zh_cn_js_default = /*#__PURE__*/ __webpack_require__.n(zh_cn_js_namespaceObject);
        external_dayjs_default().locale(zh_cn_js_default());
        const external_axios_namespaceObject = require("axios");
        var external_axios_default = /*#__PURE__*/ __webpack_require__.n(external_axios_namespaceObject);
        const http = external_axios_default().create();
        class Logger {
            mcpServer = null;
            setMcpServer(mcpServer) {
                this.mcpServer = mcpServer;
            }
            log(level, data) {
                this.mcpServer?.server.sendLoggingMessage({
                    level,
                    data
                });
            }
            info(data) {
                this.log("info", data);
            }
            error(data) {
                this.log("error", data);
            }
            warn(data) {
                this.log("warning", data);
            }
            debug(data) {
                this.log("debug", data);
            }
        }
        const logger = new Logger();
        const external_fast_xml_parser_namespaceObject = require("fast-xml-parser");
        const getRss = async (url)=>{
            const resp = await http.get(url);
            const parser = new external_fast_xml_parser_namespaceObject.XMLParser();
            return parser.parse(resp.data);
        };
        const getRssItems = async (url)=>{
            const data = await getRss(url);
            if (!Array.isArray(data.rss?.channel?.item)) return [];
            return data.rss.channel.item.map((item)=>{
                let category = '';
                if ('string' == typeof item.category) category = item.category;
                if (Array.isArray(item.category)) category = item.category.join(', ');
                return {
                    title: item.title,
                    description: item.description,
                    category,
                    author: item.author || item['dc:creator'],
                    publish_time: item.pubDate,
                    link: item.link
                };
            });
        };
        var external_zod_ = __webpack_require__("zod");
        const defineToolConfig = async (config)=>{
            if ("function" == typeof config) return await config();
            return config;
        };
        async function loadToolConfigs(toolsContext) {
            const toolPromises = toolsContext.keys().map((key)=>{
                const toolModule = toolsContext(key);
                return Promise.resolve(toolModule.default);
            });
            const results = await Promise.allSettled(toolPromises);
            return results.reduce((map, result)=>{
                if ("fulfilled" === result.status && result.value) if (Array.isArray(result.value)) result.value.forEach((tool)=>{
                    map.set(tool.name, tool);
                });
                else map.set(result.value.name, result.value);
                return map;
            }, new Map());
        }
        const handleErrorResult = (error)=>{
            let errorMessage = "";
            errorMessage = error instanceof external_zod_.ZodError ? external_zod_.z.prettifyError(error) : error instanceof Error ? error.message : JSON.stringify(error);
            return {
                content: [
                    {
                        type: "text",
                        text: errorMessage
                    }
                ],
                isError: true
            };
        };
        const handleSuccessResult = (results, toolName)=>{
            const hiddenFields = (process.env.TRENDS_HUB_HIDDEN_FIELDS ?? "").split(",").filter(Boolean).reduce((fields, config)=>{
                if (config.includes(":")) {
                    const [tool, key] = config.split(":");
                    if (tool === toolName) fields.push(key);
                } else fields.push(config);
                return fields;
            }, []);
            return {
                content: results.map((item)=>({
                        type: "text",
                        text: Object.entries(item).filter(([key, value])=>!hiddenFields.includes(key) && null != value && "" !== value).map(([key, value])=>`<${key}>${String(value)}</${key}>`).join("\n")
                    }))
            };
        };
        const safeJsonParse = (json)=>{
            try {
                return JSON.parse(json);
            } catch  {
                return;
            }
        };
    },
    "es-toolkit" (module) {
        "use strict";
        module.exports = require("es-toolkit");
    },
    "node:crypto" (module) {
        "use strict";
        module.exports = require("node:crypto");
    },
    "node:url" (module) {
        "use strict";
        module.exports = require("node:url");
    },
    zod (module) {
        "use strict";
        module.exports = require("zod");
    }
};
var __webpack_module_cache__ = {};
function __webpack_require__(moduleId) {
    var cachedModule = __webpack_module_cache__[moduleId];
    if (void 0 !== cachedModule) return cachedModule.exports;
    var module = __webpack_module_cache__[moduleId] = {
        exports: {}
    };
    __webpack_modules__[moduleId](module, module.exports, __webpack_require__);
    return module.exports;
}
(()=>{
    __webpack_require__.n = (module)=>{
        var getter = module && module.__esModule ? ()=>module['default'] : ()=>module;
        __webpack_require__.d(getter, {
            a: getter
        });
        return getter;
    };
})();
(()=>{
    __webpack_require__.d = (exports1, definition)=>{
        for(var key in definition)if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports1, key)) Object.defineProperty(exports1, key, {
            enumerable: true,
            get: definition[key]
        });
    };
})();
(()=>{
    __webpack_require__.o = (obj, prop)=>Object.prototype.hasOwnProperty.call(obj, prop);
})();
(()=>{
    __webpack_require__.r = (exports1)=>{
        if ("u" > typeof Symbol && Symbol.toStringTag) Object.defineProperty(exports1, Symbol.toStringTag, {
            value: 'Module'
        });
        Object.defineProperty(exports1, '__esModule', {
            value: true
        });
    };
})();
var __webpack_exports__ = {};
(()=>{
    "use strict";
    const mcp_js_namespaceObject = require("@modelcontextprotocol/sdk/server/mcp.js");
    const stdio_js_namespaceObject = require("@modelcontextprotocol/sdk/server/stdio.js");
    const types_js_namespaceObject = require("@modelcontextprotocol/sdk/types.js");
    var external_zod_ = __webpack_require__("zod");
    var utils = __webpack_require__("./src/utils/index.ts");
    const mcpServer = new mcp_js_namespaceObject.McpServer({
        name: "Trends Hub",
        version: "1.7.0"
    }, {
        capabilities: {
            tools: {},
            logging: {}
        }
    });
    utils.vF.setMcpServer(mcpServer);
    (async ()=>{
        try {
            const toolsContext = __webpack_require__("./src/tools sync recursive \\.(js%7Cts)$");
            const toolConfigMap = await (0, utils.s8)(toolsContext);
            mcpServer.server.setRequestHandler(types_js_namespaceObject.ListToolsRequestSchema, async ()=>({
                    tools: Array.from(toolConfigMap.values()).map((tool)=>{
                        const { name, description, zodSchema = external_zod_.z.object({}) } = tool;
                        return {
                            name,
                            description,
                            inputSchema: external_zod_.z.toJSONSchema(zodSchema)
                        };
                    })
                }));
            mcpServer.server.setRequestHandler(types_js_namespaceObject.CallToolRequestSchema, async (request)=>{
                try {
                    const tool = toolConfigMap.get(request.params.name);
                    if (!tool) throw new Error(`Tool not found: ${request.params.name}`);
                    const result = await tool.func(request.params.arguments ?? {});
                    return (0, utils.JR)(result, request.params.name);
                } catch (error) {
                    return (0, utils.Kd)(error);
                }
            });
            const transport = new stdio_js_namespaceObject.StdioServerTransport();
            await mcpServer.connect(transport);
        } catch (error) {
            console.error(error);
            process.exit(1);
        }
    })();
})();
for(var __rspack_i in __webpack_exports__)exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
