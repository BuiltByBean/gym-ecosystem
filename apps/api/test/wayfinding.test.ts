import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createFixture, type Fixture } from './fixtures.js';

let fx: Fixture;
let planId: string;

beforeAll(async () => {
  fx = await createFixture();
  const admin = fx.caller(fx.a, 'admin');
  const created = await admin.floorPlans.create({ name: 'Main Floor', widthCm: 2000, heightCm: 1200 });
  planId = created.id;
}, 180_000);

afterAll(async () => {
  await fx.destroy();
});

describe('floor plan setup', () => {
  it('places machines, and unplaced ones drop out of the palette', async () => {
    const admin = fx.caller(fx.a, 'admin');
    const before = await admin.floorPlans.unplacedUnits();
    expect(before.length).toBeGreaterThan(0);

    await admin.floorPlans.placeUnit({
      unitId: fx.a.equipment.rackUnitId,
      planId,
      xCm: 400,
      yCm: 300,
      rotationDeg: 90,
    });
    await admin.floorPlans.placeUnit({
      unitId: fx.a.equipment.legPressUnitId,
      planId,
      xCm: 1200,
      yCm: 800,
    });

    const after = await admin.floorPlans.unplacedUnits();
    expect(after.map((u) => u.unitId)).not.toContain(fx.a.equipment.rackUnitId);
    expect(before.length - after.length).toBe(2);

    const plan = await admin.floorPlans.get({ planId });
    expect(plan!.placed).toHaveLength(2);
    const rack = plan!.placed.find((p) => p.unitId === fx.a.equipment.rackUnitId)!;
    expect(rack.xCm).toBe(400);
    expect(rack.rotationDeg).toBe(90);
    // footprint comes from the model so the map is dimensionally honest
    expect(rack.widthCm).toBeGreaterThan(0);
  });

  it('zones name the area a machine sits in', async () => {
    const admin = fx.caller(fx.a, 'admin');
    await admin.floorPlans.saveZone({
      planId,
      name: 'Free Weights',
      xCm: 200,
      yCm: 100,
      widthCm: 600,
      heightCm: 500,
      color: '#2a78d6',
    });
    const located = await admin.floorPlans.locate({ exerciseId: fx.platform.exercises.backSquat });
    expect(located!.units[0]!.zoneName).toBe('Free Weights');
    expect(located!.hint).toMatch(/Free Weights/);
  });

  it('unplacing returns a machine to the palette', async () => {
    const admin = fx.caller(fx.a, 'admin');
    await admin.floorPlans.unplaceUnit({ unitId: fx.a.equipment.legPressUnitId });
    const palette = await admin.floorPlans.unplacedUnits();
    expect(palette.map((u) => u.unitId)).toContain(fx.a.equipment.legPressUnitId);
    // put it back for the wayfinding tests below
    await admin.floorPlans.placeUnit({ unitId: fx.a.equipment.legPressUnitId, planId, xCm: 1200, yCm: 800 });
  });
});

describe('member wayfinding', () => {
  it('a member can find the machine their program asked for', async () => {
    const member = fx.caller(fx.a, 'member');
    const located = await member.floorPlans.locate({ exerciseId: fx.platform.exercises.backSquat });
    expect(located!.planId).toBe(planId);
    expect(located!.units.length).toBeGreaterThan(0);
    expect(located!.hint).toContain('Power Rack');
  });

  it('resolves through equipment class when no direct link exists', async () => {
    const member = fx.caller(fx.a, 'member');
    const legPress = await member.floorPlans.locate({ exerciseId: fx.platform.exercises.legPress });
    expect(legPress!.units.some((u) => u.modelName === 'Leg Press 45')).toBe(true);
  });

  it('an explicit exercise→machine link beats a broad class match', async () => {
    const admin = fx.caller(fx.a, 'admin');
    // both fixture machines satisfy classes; link Back Squat only to the rack
    const located = await admin.floorPlans.locate({ exerciseId: fx.platform.exercises.backSquat });
    expect(located!.units.every((u) => u.modelName === 'Power Rack')).toBe(true);
  });

  it('counts units per machine, never a total across different machines', async () => {
    const admin = fx.caller(fx.a, 'admin');
    const located = await admin.floorPlans.locate({ exerciseId: fx.platform.exercises.backSquat });
    const rackCount = located!.units.filter((u) => u.modelName === 'Power Rack').length;
    // the hint must not claim more machines than that model actually has
    const claimed = /^(\d+)×/.exec(located!.hint);
    if (claimed) expect(Number(claimed[1])).toBe(rackCount);
    expect(located!.hint).not.toMatch(/^\d+× Power Rack.*Leg Press/);
  });

  it('bodyweight work reports no equipment rather than a dead end', async () => {
    const member = fx.caller(fx.a, 'member');
    const bw = await member.floorPlans.locate({ exerciseId: fx.platform.exercises.bwSquat });
    expect(bw!.planId).toBeNull();
    expect(bw!.hint).toMatch(/No equipment needed/i);
  });

  it('an out-of-service machine still shows, flagged', async () => {
    const admin = fx.caller(fx.a, 'admin');
    await admin.equipment.unitSetStatus({ unitId: fx.a.equipment.legPressUnitId, status: 'out_of_service' });
    const member = fx.caller(fx.a, 'member');
    const located = await member.floorPlans.locate({ exerciseId: fx.platform.exercises.legPress });
    expect(located!.units[0]!.status).toBe('out_of_service');
    expect(located!.hint).toMatch(/out of service/i);
    await admin.equipment.unitSetStatus({ unitId: fx.a.equipment.legPressUnitId, status: 'in_service' });
  });

  it("today's route returns ordered stops with the plan to draw", async () => {
    const member = fx.caller(fx.a, 'member');
    const plan = await member.programs.todayPlan({ assignmentId: fx.a.assignmentId });
    const route = await member.floorPlans.workoutRoute({
      programVersionId: fx.a.programVersionId,
      dayId: plan.day.id,
    });
    expect(route.plan).not.toBeNull();
    expect(route.stops.length).toBeGreaterThan(0);
    expect(route.stops[0]!.exerciseName).toBe('Back Squat');
    expect(route.stops[0]!.units.length).toBeGreaterThan(0);
  });

  it('members can read the map but never edit it', async () => {
    const member = fx.caller(fx.a, 'member');
    await expect(member.floorPlans.get({ planId })).resolves.toBeTruthy();
    await expect(
      member.floorPlans.placeUnit({ unitId: fx.a.equipment.rackUnitId, planId, xCm: 0, yCm: 0 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      member.floorPlans.create({ name: 'Sneaky', widthCm: 500, heightCm: 500 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('front desk can read the map, trainers cannot rearrange it', async () => {
    await expect(fx.caller(fx.a, 'desk').floorPlans.get({ planId })).resolves.toBeTruthy();
    await expect(
      fx.caller(fx.a, 'trainer').floorPlans.saveZone({
        planId, name: 'Nope', xCm: 0, yCm: 0, widthCm: 100, heightCm: 100, color: '#000000',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('tenant isolation of plans', () => {
  it("gym B cannot read, place onto, or delete gym A's plan", async () => {
    const bAdmin = fx.caller(fx.b, 'admin');
    // reading another gym's plan id yields nothing, not an error that confirms it
    const plan = await bAdmin.floorPlans.get({ planId });
    expect(plan).toBeNull();

    await expect(
      bAdmin.floorPlans.placeUnit({ unitId: fx.b.equipment.rackUnitId, planId, xCm: 10, yCm: 10 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // and A's plan survives B trying to remove it
    await bAdmin.floorPlans.remove({ planId });
    const stillThere = await fx.caller(fx.a, 'admin').floorPlans.get({ planId });
    expect(stillThere).not.toBeNull();
  });

  it("gym B's locate never returns gym A's machines", async () => {
    const bMember = fx.caller(fx.b, 'member');
    const located = await bMember.floorPlans.locate({ exerciseId: fx.platform.exercises.backSquat });
    expect(located!.planId).toBeNull();
    expect(located!.units).toHaveLength(0);
  });
});

describe('equipment media', () => {
  it('photos and a how-to video attach to a machine and come back in order', async () => {
    const admin = fx.caller(fx.a, 'admin');
    const modelId = fx.a.equipment.rackModelId;
    // media rows reference media_assets; create two via the admin connection
    const { uuidv7, schema } = await import('@gym/db');
    const photoId = uuidv7();
    const videoId = uuidv7();
    await fx.admin.db.insert(schema.mediaAssets).values([
      { id: photoId, gymId: fx.a.gym.id, kind: 'image', objectKey: 'test/p.jpg', mime: 'image/jpeg' },
      { id: videoId, gymId: fx.a.gym.id, kind: 'video', objectKey: 'test/v.mp4', mime: 'video/mp4' },
    ]);

    await admin.equipment.mediaAdd({ modelId, mediaId: photoId, kind: 'photo' });
    await admin.equipment.mediaAdd({ modelId, mediaId: videoId, kind: 'how_to_video' });

    const media = await admin.equipment.media({ modelId });
    expect(media.map((m) => m.kind)).toEqual(['photo', 'how_to_video']);

    // the first photo becomes the model thumbnail
    const models = await admin.equipment.models();
    expect(models.find((m) => m.id === modelId)!.photoMediaId).toBe(photoId);

    // members can view, but not attach
    const member = fx.caller(fx.a, 'member');
    await expect(member.equipment.media({ modelId })).resolves.toHaveLength(2);
    await expect(
      member.equipment.mediaAdd({ modelId, mediaId: photoId, kind: 'photo' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // removing the thumbnail photo clears it rather than leaving a dangling ref
    const photoRow = media.find((m) => m.kind === 'photo')!;
    await admin.equipment.mediaRemove({ mediaRowId: photoRow.id });
    const after = await admin.equipment.models();
    expect(after.find((m) => m.id === modelId)!.photoMediaId).toBeNull();
  });
});
