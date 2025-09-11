export type StyleKeywordGroup = {
  styleType: string;
  styleName: string[];
};

// 二级关键词配置：前端可直接导入渲染
export const STYLE_KEYWORDS: StyleKeywordGroup[] = [
  {
    styleType: "人物pose",
    styleName: [
      "photo reference poses",
      "anime reference poses",
      "sitting reference poses",
      "hand reference poses",
      "dance reference poses",
      "art reference poses",
    ],
  },
  {
    styleType: "Poster",
    styleName: [
      "瑞士国际主义风格海报",
      "迷幻艺术海报",
      "极简主义海报",
      "垃圾摇滚风海报",
      "装饰艺术海报",
    ],
  },
  {
    styleType: "Branding",
    styleName: [
      "极简主义品牌",
      "企业现代风品牌",
      "有机与自然品牌",
      "奢华与优雅品牌",
      "几何构成品牌",
    ],
  },
  {
    styleType: "Logo Design",
    styleName: [
      "扁平化Logo",
      "渐变色Logo",
      "字母组合Logo",
      "吉祥物Logo",
      "负空间Logo",
    ],
  },
  {
    styleType: "Illustration",
    styleName: [
      "扁平插画",
      "等距插画",
      "手绘涂鸦风插画",
      "水彩质感插画",
      "孟菲斯风格插画",
    ],
  },
  {
    styleType: "IP Design",
    styleName: [
      "日系动漫风",
      "Q版/赤壁风",
      "迪士尼/皮克斯风格",
      "盲盒/潮玩风格",
      "扁平角色风",
    ],
  },
  {
    styleType: "Relight Your Picture",
    styleName: ["电影感调色", "黑色电影", "黄金时刻", "霓虹灯光", "伦勃朗光"],
  },
  {
    styleType: "尺寸比例",
    styleName: [
      "9:16",
      "16:9",
      "21:9",
      "2:3",
      "3:2",
      "4:5",
      "5:4",
      "9:16",
      "9:21",
      "1:1",
    ],
  },
  {
    styleType: "纯色背景",
    styleName: [
      "White background",
      "Black background",
      "Gray background",
      "Blue background",
      "Red background",
      "Green background",
      "Yellow background",
      "Purple background",
      "Orange background",
      "Pink background",
    ],
  },
  {
    styleType: "Product-to-Image",
    styleName: [
      "超写实主义产品",
      "极简静物",
      "生活方式场景",
      "工业风",
      "工作室布光",
    ],
  },
  {
    styleType: "Merch Design",
    styleName: ["波普艺术", "街头潮流风", "复古怀旧", "字体设计", "涂鸦艺术"],
  },
  {
    styleType: "3D Model",
    styleName: ["低面建模", "照片级渲染", "卡通3D", "体素艺术", "黏土风"],
  },
  {
    styleType: "Emoji Generation",
    styleName: [
      "扁平化Emoji",
      "3D Fluent设计Emoji",
      "拟物化Emoji",
      "像素艺术Emoji",
      "动态表情Emoji",
    ],
  },
  {
    styleType: "3D Rotation",
    styleName: [
      "线框渲染",
      "全息投影",
      "卡通着色",
      "技术爆炸图",
      "360°产品展示",
    ],
  },
  {
    styleType: "Outfit Swap",
    styleName: [
      "街头潮流服饰",
      "高级时装",
      "复古穿搭服饰",
      "哥特风格服饰",
      "赛博朋克服饰",
    ],
  },
  {
    styleType: "Make Your Own Stickers",
    styleName: [
      "可爱/Kawaii风贴纸",
      "波普艺术贴纸",
      "复古贴纸",
      "手写字体贴纸",
      "梗图/Meme风贴纸",
    ],
  },
  {
    styleType: "Storyboarding",
    styleName: [
      "铅笔素描",
      "黑白影调",
      "线条艺术",
      "日式动画分镜",
      "电影感构图故事板",
    ],
  },
  {
    styleType: "Interior Design",
    styleName: [
      "斯堪的纳维亚/北欧风",
      "工业风",
      "中世纪现代风",
      "波西米亚风",
      "侘寂风",
    ],
  },
  {
    styleType: "Font Design",
    styleName: [
      "迷幻字体",
      "动态字体",
      "手写花体",
      "野兽派/新丑风字体",
      "复古浪潮字体",
    ],
  },
  {
    styleType: "Fashion Modeling",
    styleName: ["高级时装", "街头风格", "先锋艺术", "杂志大片", "商业广告"],
  },
  {
    styleType: "The Good Oldies",
    styleName: [
      "复古照片",
      "装饰艺术风",
      "中世纪现代",
      "波普艺术",
      "胶片颗粒感",
    ],
  },
  {
    styleType: "Back to Y2K",
    styleName: [
      "Y2K美学",
      "Frutiger Aero",
      "赛博核",
      "镭射/全息质感",
      "光泽果冻感",
    ],
  },
  {
    styleType: "Sit Over There",
    styleName: ["奇幻场景", "科幻世界", "生活切片", "超现实主义", "黑色电影"],
  },
  {
    styleType: "IP Mashup",
    styleName: [
      "波普艺术拼贴",
      "卡通乱斗",
      "解构主义",
      "超现实组合",
      "贴纸爆炸",
    ],
  },
  {
    styleType: "Colorize it",
    styleName: ["特艺七彩", "棕褐色调", "单色风格", "马卡龙色系", "高饱和度"],
  },
  {
    styleType: "Character Reference",
    styleName: [
      "动漫概念艺术",
      "幻想角色设计",
      "科幻机甲",
      "DND风格",
      "美式卡通",
    ],
  },
  {
    styleType: "Figurine it",
    styleName: [
      "潮玩风格",
      "粘土/Nendoroid",
      "写实手办",
      "Funko Pop风格",
      "定格动画",
    ],
  },
  {
    styleType: "Banana Cat Figurine",
    styleName: [
      "潮玩手办",
      "黏土定格风",
      "低面建模",
      "Meme超现实主义",
      "超写实渲染",
    ],
  },
  {
    styleType: "Repose it",
    styleName: [
      "动态瞬间",
      "对立式平衡",
      "古典绘画姿势",
      "英雄式站姿",
      "沉思冥想",
    ],
  },
  {
    styleType: "Change the Perspective",
    styleName: ["鱼眼镜头", "仰视视角", "俯视视角", "等距视角", "强迫透视"],
  },
  {
    styleType: "World Travel",
    styleName: [
      "复古明信片",
      "旅行纪实摄影",
      "冒险地图风",
      "双重曝光",
      "城市探索",
    ],
  },
];
