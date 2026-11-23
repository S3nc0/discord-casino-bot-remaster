import json,re,sys
t=json.load(open(sys.argv[1]))
themes=[th['id'] for th in t['color']['themes']]
def v(x): return re.sub(r'\{([^}]+)\}',r'var(--\1)',str(x))
light=[];dark=[]
for fam,d in t.items():
    if fam in('name','version','type'): continue
    for tok in d['tokens']:
        val=tok['value']
        if isinstance(val,dict):
            light.append(f"  --{tok['name']}: {v(val.get('light',list(val.values())[0]))};")
            if 'dark' in val and val['dark']!=val.get('light'): dark.append(f"  --{tok['name']}: {v(val['dark'])};")
        else: light.append(f"  --{tok['name']}: {v(val)};")
fams=t['type']['families']
# a family that repeats the body stack (numeric) points at it, as the app's tokens.css does
for k,f in fams.items(): light.append(f"  --font-{k}: {'var(--font-body)' if k!='body' and f==fams.get('body') else f};")
out=["/* Bitbloom — generated from tokens.json. Do not edit by hand. */",":root, [data-theme=\"light\"] {",*light,"}",
"[data-theme=\"dark\"] {",*dark,"}","@media (prefers-color-scheme: dark) {",":root:not([data-theme=\"light\"]) {",*dark,"}","}"]
for g in t['type']['groups']:
    for s in g['styles']:
        fam=g.get('family','body')
        out.append(f".type-{s['name']} {{ font-family: var(--font-{fam}); font-size: {s['fontSize']}; line-height: {s['lineHeight']}; font-weight: {s['fontWeight']}; }}")
open(sys.argv[2],'w').write("\n".join(out)+"\n")
