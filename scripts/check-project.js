/**
 * 项目静态自检：不需要微信开发者工具，用 node 跑一遍
 * 用法：node scripts/check-project.js
 *
 * 检查项：
 *  1. app.json 声明的页面，四类文件是否齐全
 *  2. tabBar 的 pagePath 是否都在 pages 列表中
 *  3. 页面/组件 usingComponents 指向的组件是否存在
 *  4. 所有 require() 的相对路径是否能解析到真实文件
 *  5. cloudfunctions 下每个函数是否有 index.js + package.json
 *  6. project.config.json 的 miniprogramRoot / cloudfunctionRoot 是否与实际目录一致
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const CF = path.join(ROOT, 'cloudfunctions')

const errors = []
const warnings = []
const info = []

function exists(p) {
  return fs.existsSync(p)
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (e) {
    errors.push(`JSON 解析失败: ${path.relative(ROOT, p)} -> ${e.message}`)
    return null
  }
}

/* 1 & 2. 页面与 tabBar */
const appJson = readJson(path.join(MP, 'app.json'))
if (!appJson) {
  console.error('app.json 读取失败，终止')
  process.exit(1)
}

const pages = appJson.pages || []
info.push(`页面数：${pages.length}`)

pages.forEach((p) => {
  ;['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
    const file = path.join(MP, `${p}.${ext}`)
    if (!exists(file)) errors.push(`页面文件缺失: ${p}.${ext}`)
  })
})

const tabList = (appJson.tabBar && appJson.tabBar.list) || []
tabList.forEach((t) => {
  if (!pages.includes(t.pagePath)) {
    errors.push(`tabBar 页面未在 pages 中声明: ${t.pagePath}`)
  }
})

/* 3. usingComponents */
function checkComponents(jsonPath) {
  const j = readJson(jsonPath)
  if (!j || !j.usingComponents) return
  Object.entries(j.usingComponents).forEach(([name, target]) => {
    let resolved
    if (target.startsWith('/')) {
      resolved = path.join(MP, target)
    } else {
      resolved = path.resolve(path.dirname(jsonPath), target)
    }
    ;['js', 'json', 'wxml'].forEach((ext) => {
      if (!exists(`${resolved}.${ext}`)) {
        errors.push(`${path.relative(ROOT, jsonPath)} 引用的组件 ${name} 缺文件: ${target}.${ext}`)
      }
    })
  })
}

pages.forEach((p) => checkComponents(path.join(MP, `${p}.json`)))
const compDir = path.join(MP, 'components')
if (exists(compDir)) {
  fs.readdirSync(compDir).forEach((d) => {
    const f = path.join(compDir, d, 'index.json')
    if (exists(f)) checkComponents(f)
  })
}

/* 4. require 路径 */
function walk(dir, out = []) {
  if (!exists(dir)) return out
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules') return
      walk(full, out)
    } else if (e.name.endsWith('.js')) {
      out.push(full)
    }
  })
  return out
}

const jsFiles = [...walk(MP), ...walk(CF)]
jsFiles.forEach((file) => {
  const src = fs.readFileSync(file, 'utf8')
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g
  let m
  while ((m = re.exec(src))) {
    const base = path.resolve(path.dirname(file), m[1])
    const candidates = [base, `${base}.js`, path.join(base, 'index.js')]
    if (!candidates.some(exists)) {
      errors.push(`${path.relative(ROOT, file)} 引用不存在的模块: ${m[1]}`)
    }
  }
})

/* 5. 云函数完整性 */
if (exists(CF)) {
  const fns = fs.readdirSync(CF, { withFileTypes: true }).filter((e) => e.isDirectory())
  info.push(`云函数数：${fns.length}`)
  fns.forEach((f) => {
    if (!exists(path.join(CF, f.name, 'index.js'))) {
      errors.push(`云函数 ${f.name} 缺少 index.js`)
    }
    if (!exists(path.join(CF, f.name, 'package.json'))) {
      errors.push(`云函数 ${f.name} 缺少 package.json`)
    } else {
      const pkg = readJson(path.join(CF, f.name, 'package.json'))
      if (pkg && !(pkg.dependencies && pkg.dependencies['wx-server-sdk'])) {
        warnings.push(`云函数 ${f.name} 未声明 wx-server-sdk 依赖`)
      }
    }
  })
}

/* 6. wx.showModal 按钮文案长度（超过 4 字会导致调用直接 fail，界面表现为「点了没反应」） */
jsFiles
  .filter((f) => f.startsWith(MP))
  .forEach((file) => {
    const src = fs.readFileSync(file, 'utf8')
    const patterns = [
      { name: 'confirmText', re: /confirmText\s*:\s*['"]([^'"]*)['"]/g },
      { name: 'cancelText', re: /cancelText\s*:\s*['"]([^'"]*)['"]/g },
      { name: 'confirmText(默认值)', re: /confirmText\s*\|\|\s*['"]([^'"]*)['"]/g }
    ]
    patterns.forEach(({ name, re }) => {
      let m
      while ((m = re.exec(src))) {
        const text = m[1]
        if (text.length > 4) {
          errors.push(
            `${path.relative(ROOT, file)} ${name} = "${text}" 有 ${text.length} 个字符，showModal 最多 4 个`
          )
        }
      }
    })
  })

/* 7. 根配置 */
const proj = readJson(path.join(ROOT, 'project.config.json'))
if (proj) {
  if (proj.miniprogramRoot && !exists(path.join(ROOT, proj.miniprogramRoot.replace(/\/$/, '')))) {
    errors.push(`miniprogramRoot 指向的目录不存在: ${proj.miniprogramRoot}`)
  }
  if (proj.cloudfunctionRoot && !exists(path.join(ROOT, proj.cloudfunctionRoot.replace(/\/$/, '')))) {
    errors.push(`cloudfunctionRoot 指向的目录不存在: ${proj.cloudfunctionRoot}`)
  }
  if (!proj.appid || proj.appid === 'touristappid') {
    warnings.push('project.config.json 的 appid 仍是占位值，云开发需要填自己的小程序 AppID')
  }
}

/* 输出 */
console.log('=== 项目自检 ===')
info.forEach((i) => console.log('· ' + i))

if (warnings.length) {
  console.log('\n警告：')
  warnings.forEach((w) => console.log('! ' + w))
}

if (errors.length) {
  console.log('\n错误：')
  errors.forEach((e) => console.log('✗ ' + e))
  console.log(`\n结果：${errors.length} 个错误，${warnings.length} 个警告`)
  process.exit(1)
}

console.log(`\n结果：通过，0 个错误，${warnings.length} 个警告`)
