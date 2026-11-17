//! Programs Mímir saved before templates had a `plan`: the old shape, read
//! strictly, and turned into the new one. The store converts a stored row
//! once, when it loads it, and writes the new shape back; a row that is
//! neither shape is a problem shown in red, never dropped quietly.
//!
//! The old shape: `exerciseIds`, a `scheme`, an optional `estimateMinutes`,
//! and at most one of `interval`, `emom`, `flow`, `forTime`, `ride` (none
//! meant a logged session). The interval, EMOM and flow schemes were the
//! app's own computed text then too, so they are dropped, not kept as notes.

use serde::Deserialize;
use serde_json::Value;

use crate::model::{
    ChatItem, EmomStation, EmomWarmup, FlowStep, ForTimeStage, Level, MusicProfile, Plan, RideSegment, Template,
    TemplateGear,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OldInterval {
    work: i32,
    rest: i32,
    rounds: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OldEmom {
    minute: i32,
    rounds: i32,
    stations: Vec<EmomStation>,
    #[serde(default)]
    warmup: Option<Vec<EmomWarmup>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OldFlow {
    steps: Vec<FlowStep>,
    transition: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OldForTime {
    stages: Vec<ForTimeStage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OldRide {
    segments: Vec<RideSegment>,
    #[serde(default)]
    race: Option<bool>,
    #[serde(default)]
    free: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OldTemplate {
    id: String,
    name: String,
    branch: String,
    description: String,
    scheme: String,
    level: Level,
    #[serde(default)]
    estimate_minutes: Option<i32>,
    exercise_ids: Vec<String>,
    music: MusicProfile,
    #[serde(default)]
    interval: Option<OldInterval>,
    #[serde(default)]
    for_time: Option<OldForTime>,
    #[serde(default)]
    flow: Option<OldFlow>,
    #[serde(default)]
    emom: Option<OldEmom>,
    #[serde(default)]
    gear: Option<TemplateGear>,
    #[serde(default)]
    ride: Option<OldRide>,
}

fn needs_estimate(id: &str, kind: &str, minutes: Option<i32>) -> Result<i32, String> {
    minutes.ok_or_else(|| format!("old program {id}: a {kind} program needs estimateMinutes"))
}

impl OldTemplate {
    fn into_template(self) -> Result<Template, String> {
        let players = [
            self.interval.is_some(),
            self.for_time.is_some(),
            self.flow.is_some(),
            self.emom.is_some(),
            self.ride.is_some(),
        ]
        .into_iter()
        .filter(|b| *b)
        .count();
        if players > 1 {
            return Err(format!("old program {}: more than one of interval, forTime, flow, emom, ride", self.id));
        }
        let plan = if let Some(iv) = self.interval {
            Plan::Interval { stations: self.exercise_ids, work: iv.work, rest: iv.rest, rounds: iv.rounds, note: None }
        } else if let Some(em) = self.emom {
            Plan::Emom { minute: em.minute, rounds: em.rounds, stations: em.stations, warmup: em.warmup, note: None }
        } else if let Some(fl) = self.flow {
            Plan::Flow { steps: fl.steps, transition: fl.transition, note: None }
        } else if let Some(ft) = self.for_time {
            Plan::ForTime {
                stages: ft.stages,
                scheme: self.scheme,
                estimate_minutes: needs_estimate(&self.id, "for-time", self.estimate_minutes)?,
            }
        } else if let Some(r) = self.ride {
            Plan::Ride { segments: r.segments, race: r.race, free: r.free, scheme: self.scheme, estimate_minutes: self.estimate_minutes }
        } else {
            Plan::Logged {
                exercises: self.exercise_ids,
                scheme: self.scheme,
                estimate_minutes: needs_estimate(&self.id, "logged", self.estimate_minutes)?,
            }
        };
        Ok(Template {
            id: self.id,
            name: self.name,
            branch: self.branch,
            description: self.description,
            level: self.level,
            plan,
            music: self.music,
            gear: self.gear,
        })
    }
}

/// A stored template: the current shape, or the old one converted. The
/// flag says it was converted, so the store writes the new shape back.
pub fn read_template(value: Value) -> Result<(Template, bool), String> {
    match serde_json::from_value::<Template>(value.clone()) {
        Ok(t) => Ok((t, false)),
        Err(current) => match serde_json::from_value::<OldTemplate>(value) {
            Ok(old) => old.into_template().map(|t| (t, true)),
            Err(_) => Err(current.to_string()),
        },
    }
}

/// A stored chat item; a program card in the old shape is converted.
pub fn read_chat_item(value: Value) -> Result<(ChatItem, bool), String> {
    match serde_json::from_value::<ChatItem>(value.clone()) {
        Ok(item) => Ok((item, false)),
        Err(current) => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct OldProgramItem {
                kind: String,
                template: Value,
                #[serde(default)]
                replaces: Option<String>,
                #[serde(default)]
                saved: Option<bool>,
            }
            let old: OldProgramItem = serde_json::from_value(value).map_err(|_| current.to_string())?;
            if old.kind != "program" {
                return Err(current.to_string());
            }
            let (template, _) = read_template(old.template)?;
            Ok((ChatItem::Program { template: Box::new(template), replaces: old.replaces, saved: old.saved }, true))
        }
    }
}
