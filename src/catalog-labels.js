/*
 * Localized display labels for game catalog entries.
 *
 * The canonical item/facility data stays in assets/*.json.  This layer only
 * changes UI labels, so solver input and imported data remain stable.
 */
(function (global) {
  const dictionaryLabels = {
    item: {},
    facility: {},
  };

  const itemLabels = {
    item_proc_battery_5: { ja: "中容量武陵バッテリー", "zh-CN": "中容量武陵电池" },
    item_proc_battery_4: { ja: "小容量武陵バッテリー", "zh-CN": "小容量武陵电池" },
    item_xiranite_enr_powder: { ja: "重息壌", "zh-CN": "重息壤" },
    item_xiranite_powder: { ja: "息壌", "zh-CN": "息壤" },
    item_copper_enr_cmpt: { ja: "緋銅部品", "zh-CN": "绯铜部件" },
    item_copper_cmpt: { ja: "赤銅部品", "zh-CN": "赤铜部件" },
    item_bottled_rec_hp_5: { ja: "芽針注射剤A", "zh-CN": "芽针注射剂A" },
    item_bottled_rec_hp_4: { ja: "芽針注射剤C", "zh-CN": "芽针注射剂C" },
    item_bottled_food_5: { ja: "錦草茶", "zh-CN": "锦草茶" },
    item_bottled_food_4: { ja: "錦草飲料", "zh-CN": "锦草饮料" },
    item_plant_grass_2: { ja: "芽針", "zh-CN": "芽针" },
    item_plant_grass_1: { ja: "錦草", "zh-CN": "锦草" },
    item_xiranite_powder_bottle: { ja: "息壌ボトル", "zh-CN": "息壤瓶" },

    item_originium_ore: { ja: "源石鉱物", "zh-CN": "源石矿物" },
    item_iron_ore: { ja: "青鉄鉱物", "zh-CN": "青铁矿物" },
    item_copper_ore: { ja: "赤銅鉱物", "zh-CN": "赤铜矿物" },
    item_originium_powder: { ja: "源石粉末", "zh-CN": "源石粉末" },
    item_originium_enr_powder: { ja: "高密度源石粉末", "zh-CN": "高密度源石粉末" },
    item_iron_powder: { ja: "青鉄粉末", "zh-CN": "青铁粉末" },
    item_iron_enr_powder: { ja: "高密度青鉄粉末", "zh-CN": "高密度青铁粉末" },
    item_copper_nugget: { ja: "赤銅塊", "zh-CN": "赤铜块" },
    item_copper_enr: { ja: "緋銅", "zh-CN": "绯铜" },
    item_copper_bottle: { ja: "赤銅ボトル", "zh-CN": "赤铜瓶" },
    item_copper_enr_bottle: { ja: "緋銅ボトル", "zh-CN": "绯铜瓶" },

    item_liquid_water: { ja: "水", "zh-CN": "水" },
    item_liquid_acid: { ja: "沈殿酸", "zh-CN": "沉淀酸" },
    item_liquid_sewage: { ja: "汚水", "zh-CN": "污水" },
    item_liquid_xiranite_lowpoly: { ja: "不活性壌晶廃液", "zh-CN": "惰性壤晶废液" },
    item_liquid_xiranite_poly: { ja: "壌晶廃液", "zh-CN": "壤晶废液" },
    item_xiranite_poly: { ja: "壌晶", "zh-CN": "壤晶" },

    item_plant_moss_1: { ja: "蕎花", "zh-CN": "荞花" },
    item_plant_moss_powder_1: { ja: "蕎花粉末", "zh-CN": "荞花粉末" },
    item_plant_moss_2: { ja: "シトローム", "zh-CN": "Citrome" },
    item_plant_moss_powder_2: { ja: "シトローム粉末", "zh-CN": "Citrome 粉末" },
    item_plant_moss_3: { ja: "サンドリーフ", "zh-CN": "Sandleaf" },
    item_plant_moss_powder_3: { ja: "サンドリーフ粉末", "zh-CN": "Sandleaf 粉末" },
    item_plant_grass_powder_2: { ja: "芽針粉末", "zh-CN": "芽针粉末" },
    item_plant_grass_seed_2: { ja: "芽針種子", "zh-CN": "芽针种子" },
    item_plant_grass_powder_1: { ja: "錦草粉末", "zh-CN": "锦草粉末" },
    item_plant_grass_seed_1: { ja: "錦草種子", "zh-CN": "锦草种子" },

    item_activity_xiranite_cmpt: { ja: "息壌装備部品", "zh-CN": "息壤装备部件" },
    item_activity_xiranite_enr_cmpt: { ja: "重息壌装備部品", "zh-CN": "重息壤装备部件" },
    item_activity_xiranite_bottle: { ja: "息壌ボトル", "zh-CN": "息壤瓶" },
    item_activity_xiranite_enr_bottle: { ja: "重息壌ボトル", "zh-CN": "重息壤瓶" },
    item_equip_script_4: { ja: "息壌装備部品", "zh-CN": "息壤装备部件" },
    item_equip_script_4_1: { ja: "赤銅装備部品", "zh-CN": "赤铜装备部件" },
    item_equip_script_4_2: { ja: "緋銅装備部品", "zh-CN": "绯铜装备部件" },
  };

  const facilityLabels = {
    component_mc_1: { ja: "組立機", "zh-CN": "组装机" },
    dismantler_1: { ja: "分離機", "zh-CN": "分离机" },
    filling_powder_mc_1: { ja: "充填機", "zh-CN": "填充机" },
    furnance_1: { ja: "精錬炉", "zh-CN": "精炼炉" },
    grinder_1: { ja: "粉砕機", "zh-CN": "粉碎机" },
    liquid_cleaner_1: { ja: "廃水処理機", "zh-CN": "废水处理机" },
    liquid_purifier_1: { ja: "精製機", "zh-CN": "精制机" },
    liquidcleanfactory_005_1: { ja: "浄化装置" },
    loader_1: { ja: "倉庫ローダー", "zh-CN": "仓库装载器" },
    mix_pool_1: { ja: "化学反応炉", "zh-CN": "化学反应炉" },
    mix_pool_2: { ja: "大型化学反応炉", "zh-CN": "大型化学反应炉" },
    planter_1: { ja: "栽培機", "zh-CN": "栽培机" },
    pump_1: { ja: "液体ポンプ", "zh-CN": "液体泵" },
    pump_2: { ja: "耐酸性液体ポンプII", "zh-CN": "耐酸液体泵II" },
    seedcollector_1: { ja: "採種機", "zh-CN": "采种机" },
    shaper_1: { ja: "成形機", "zh-CN": "成型机" },
    thickener_1: { ja: "研磨機", "zh-CN": "研磨机" },
    tools_assebling_mc_1: { ja: "包装機", "zh-CN": "包装机" },
    winder_1: { ja: "巻線機", "zh-CN": "绕线机" },
    xiranite_oven_1: { ja: "天有洪炉", "zh-CN": "天有洪炉" },
  };

  function currentLocale() {
    return global.WulingI18n?.getLocale?.() || "en";
  }

  function idOf(entryOrId) {
    return typeof entryOrId === "string" ? entryOrId : entryOrId?.id;
  }

  async function loadJson(path) {
    try {
      const response = await fetch(path);
      if (!response.ok) return {};
      return await response.json();
    } catch {
      return {};
    }
  }

  async function loadLocale(locale) {
    if (dictionaryLabels.item[locale] && dictionaryLabels.facility[locale]) return;
    const [items, facilities] = await Promise.all([
      loadJson(`assets/locales/${locale}/item.json`),
      loadJson(`assets/locales/${locale}/facility.json`),
    ]);
    dictionaryLabels.item[locale] = items;
    dictionaryLabels.facility[locale] = facilities;
  }

  async function load(locales = ["ja", "zh-CN"]) {
    await Promise.all(locales.map(loadLocale));
  }

  function localized(kind, table, entryOrId, fallback) {
    const id = typeof entryOrId === "string" ? entryOrId : entryOrId?.id;
    const data = table[id];
    const locale = currentLocale();
    return dictionaryLabels[kind]?.[locale]?.[id]
      || data?.[locale]
      || data?.[locale.split("-")[0]]
      || fallback
      || (typeof entryOrId === "object" ? entryOrId?.name : "")
      || id
      || "";
  }

  function searchText(kind, table, entryOrId, fallback) {
    const id = idOf(entryOrId);
    const data = table[id] || {};
    return [
      fallback,
      dictionaryLabels[kind]?.ja?.[id],
      dictionaryLabels[kind]?.["zh-CN"]?.[id],
      data.en,
      data.ja,
      data["zh-CN"],
      id,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  global.WulingCatalogLabels = {
    load,
    itemName(entryOrId, fallback) {
      return localized("item", itemLabels, entryOrId, fallback);
    },
    facilityName(entryOrId, fallback) {
      return localized("facility", facilityLabels, entryOrId, fallback);
    },
    itemSearchText(entryOrId, fallback) {
      return searchText("item", itemLabels, entryOrId, fallback);
    },
    facilitySearchText(entryOrId, fallback) {
      return searchText("facility", facilityLabels, entryOrId, fallback);
    },
    itemLabels,
    facilityLabels,
    dictionaryLabels,
  };
})(globalThis);
