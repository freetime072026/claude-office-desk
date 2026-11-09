// Fixture kế hoạch PO cho test: mốc chưa ghi requirements thì điền mỗi khối làm việc một hạng mục cỡ M (mốc không có khối làm việc:
// một hạng mục thiết kế cho GD), để test của phần khác không phải viết bảng phủ yêu cầu (po.cjs kiểm bắt buộc).
const { labelsOf } = require('../po.cjs');
const KIND = { Dev: 'code', VFX: 'vfx', Art: 'art', Anim: 'anim', Sound: 'sound' };
const typeOf = label => label.replace(/ #\d+$/, '');
function withRequirements(value) {
  if (!Array.isArray(value?.milestones)) return value;
  return { ...value, milestones: value.milestones.map((milestone, index) => {
    if (!milestone || milestone.requirements !== undefined || !Array.isArray(milestone.blocks)) return milestone;
    const workers = labelsOf(milestone.blocks.map(String)).filter(label => KIND[typeOf(label)]);
    const requirements = workers.length ? workers.map(label => ({ id: `T${index + 1}-${label}`, text: 'Làm phần của ' + label, kind: KIND[typeOf(label)], size: 'M', owners: [label] }))
      : [{ id: `T${index + 1}-GD`, text: 'Thiết kế mốc', kind: 'design', size: 'S', owners: ['GD'] }];
    return { ...milestone, requirements };
  }) };
}
const teamFence = value => '```team\n' + JSON.stringify(withRequirements(value)) + '\n```';
module.exports = { withRequirements, teamFence };
