import { $, empty, esc, filters } from './ui.js';
import { api } from './api.js';
import { session } from './state.js';

export function portfolio(p) {
    return p
        ? `<section class="card"><h3>Portfolio</h3><p>${p.skills.map(esc).join(" · ") || "No skills added."}</p><h3>Certifications</h3>${p.certifications.length ? p.certifications.map((c) => `<p>${esc(c.name)} · ${esc(c.issuer || "")} ${esc(c.year || "")}</p>`).join("") : "<p>No certifications added.</p>"}<h3>Projects</h3>${(p.projects || []).map((p) => `<p><strong>${esc(p.title)}</strong><br>${esc(p.description)}</p>`).join("") || "<p>No projects added.</p>"}</section>`
        : "<p>No portfolio added yet.</p>";
}

export function bars(rows, label, value) {
    const max = Math.max(1, ...rows.map((r) => r[value]));
    return rows
        .map(
            (r) =>
                `<div class="bar-row"><span>${esc(r[label])}</span><div class="bar"><i style="width:${(r[value] / max) * 100}%"></i></div><span>${r[value]}</span></div>`,
        )
        .join("");
}

export async function selectFreelancer(ticket,name,id) {
    if (session.actor.role !== "freelancer") {
        filters(`<label>${session.actor.role==="admin"?"Search by name or ID":"Find freelancer by name"}<input type="search" name="search" placeholder="${session.actor.role==="admin"?"Name or freelancer ID":"Freelancer name"}"></label>${session.actor.role==="client"&&name==="analytics"?'<label>Show<select name="workedWith"><option value="">All freelancers</option><option value="true">Previously worked with</option></select></label>':''}<button type="button" id="analytics-search">Search</button><label>Choose freelancer<select name="freelancerId" required><option value="">Loading freelancers…</option></select></label><button>${name === "reviews" ? "View portfolio & reviews" : "View analytics"}</button><div id="analytics-options" role="status"></div><div id="analytics-option-pages" class="actions"></div>`,name);
        let optionPage=1,optionRequest=0;
        async function loadOptions(initial=false){
            const request=++optionRequest;
            const form=$("#filters"),select=form.elements.freelancerId;
            const previous=select.value||id;
            $("#analytics-options").textContent="Loading freelancers…";
            try {
                const q=new URLSearchParams({page:optionPage,limit:10,search:form.elements.search.value});
                if(form.elements.workedWith?.value)q.set("workedWith",form.elements.workedWith.value);
                const result=await api("freelancers?"+q);
                if(ticket!==session.generation||request!==optionRequest)return;
                let chosen=result.data.find(f=>String(f.id)===String(previous));
                // Preserve profile deep links only on the initial unrestricted selection load.
                if(initial&&previous&&!chosen&&!q.get("workedWith"))chosen=(await api(`freelancers/${previous}`)).data;
                if(ticket!==session.generation||request!==optionRequest)return;
                const options=[...result.data];if(chosen&&!options.some(f=>f.id===chosen.id))options.push(chosen);
                select.innerHTML='<option value="">Choose a freelancer</option>'+options.map(f=>`<option value="${f.id}">${esc(f.name)}${session.actor.role==="admin"?` · ID ${f.id}`:""}</option>`).join('');
                select.value=String(chosen?.id||result.data[0]?.id||'');
                $("#analytics-options").textContent=result.total?`${result.total} matching freelancers${q.get('workedWith')?' with in-progress or completed contracts with you':''}.`:'No matching freelancers. Try All freelancers or another name.';
                $("#analytics-option-pages").innerHTML=`<button type="button" data-option-page="-1" ${optionPage<=1?'disabled':''}>Previous names</button><span>Page ${optionPage} of ${result.totalPages||1}</span><button type="button" data-option-page="1" ${optionPage>=result.totalPages?'disabled':''}>Next names</button>`;
                return select.value;
            }catch(error){if(ticket===session.generation&&request===optionRequest)$("#analytics-options").innerHTML=`${esc(error.message)} <button type="button" id="analytics-option-retry">Retry</button>`;$("#analytics-option-retry")?.addEventListener('click',()=>loadOptions());}
        }
        $("#analytics-search").onclick=()=>{optionPage=1;loadOptions();};
        $("#filters").elements.search.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();optionPage=1;loadOptions();}};
        if($("#filters").elements.workedWith)$("#filters").elements.workedWith.onchange=()=>{optionPage=1;loadOptions();};
        $("#analytics-option-pages").onclick=event=>{const button=event.target.closest('[data-option-page]');if(button&&!button.disabled){optionPage+=Number(button.dataset.optionPage);loadOptions();}};
        const selection=await loadOptions(true);
        if(ticket!==session.generation)return;
        id=selection;
        if(!id){$("#content").innerHTML=empty("Choose a freelancer to view analytics.");return;}
    }else filters('',name);
    return id;
}
